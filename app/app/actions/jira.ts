"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { normalizeJiraHost, validateCredentials, fetchProjects, JiraError } from "@/lib/jira";
import { jiraSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { csvSafe } from "@/lib/csv";
import { logEvent } from "@/lib/audit";
import { fileIntegrationCsv, disconnectProvider, INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { encryptSecret, decryptSecret, isEncryptionConfigured, ENCRYPTION_NOT_CONFIGURED } from "@/lib/crypto";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

export async function connectJira(input: { site: string; email: string; token: string }) {
  const parsed = jiraSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const host = normalizeJiraHost(parsed.data.site);
  if (!host) return { error: "Enter your Jira site, e.g. your-company.atlassian.net." };

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let company;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return { error: DB_ERROR };
  }
  if (!company) return { error: "No company found." };
  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { error: denied };
  if (!isEncryptionConfigured()) return { error: ENCRYPTION_NOT_CONFIGURED };

  let account: string;
  try {
    account = await validateCredentials(host, parsed.data.email, parsed.data.token);
  } catch (err) {
    return { error: err instanceof JiraError ? err.userMessage : "Couldn't reach Jira." };
  }

  const { error } = await supabase.from("integrations").upsert(
    {
      company_id: company.id,
      provider: "jira",
      access_token: encryptSecret(
        JSON.stringify({ host, email: parsed.data.email, token: parsed.data.token }),
      ),
      status: "connected",
      connected_by: user.id,
      metadata: { site: host, account },
    },
    { onConflict: "company_id,provider" },
  );
  if (error) return { error: DB_ERROR };

  await logEvent(supabase, company.id, "integration.connected", {
    type: "integration",
    id: "jira",
    label: INTEGRATION_LABELS.jira,
    metadata: { site: host },
  });

  revalidatePath("/integrations");
  return { ok: true, site: host };
}

export async function syncJira() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let company;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return { error: DB_ERROR };
  }
  if (!company) return { error: "No company found." };
  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { error: denied };

  if (!checkRateLimit(`jira-sync:${company.id}`, 1, 60_000)) {
    return { error: "Already synced recently — try again in a minute." };
  }

  const { data: integ } = await supabase
    .from("integrations")
    .select("id, access_token, status")
    .eq("company_id", company.id)
    .eq("provider", "jira")
    .maybeSingle();
  if (!integ?.access_token || integ.status === "disconnected") {
    return { error: "Jira isn't connected yet." };
  }

  let creds: { host: string; email: string; token: string };
  try {
    creds = JSON.parse(decryptSecret(integ.access_token));
  } catch {
    return { error: "Stored credentials are corrupt — please reconnect." };
  }

  try {
    const r = await fetchProjects(creds.host, creds.email, creds.token);
    const csv = [
      `# Jira projects report`,
      `# Generated: ${new Date().toISOString()}`,
      `# Company: ${company.name}`,
      `# Summary: ${r.totalProjects} projects tracked for change management`,
      ``,
      `project_key,project_name`,
      ...r.projects.map((p) => `${csvSafe(p.key)},${csvSafe(p.name)}`),
    ].join("\n");

    const filed = await fileIntegrationCsv({
      supabase,
      companyId: company.id,
      userId: user.id,
      integrationId: integ.id,
      fileBase: "jira-projects",
      csv,
      note: `Automated Jira sync: ${r.totalProjects} projects tracked.`,
    });
    if (filed.error) return { error: filed.error };

    revalidatePath("/integrations");
    revalidatePath("/evidence");
    return { ok: true, summary: { projects: r.totalProjects } };
  } catch (err) {
    if (err instanceof JiraError) {
      if (err.kind === "auth") {
        await supabase.from("integrations").update({ status: "error" }).eq("id", integ.id);
        revalidatePath("/integrations");
      }
      return { error: err.userMessage };
    }
    return { error: "Sync failed. Please try again." };
  }
}

export async function disconnectJira() {
  return disconnectProvider("jira");
}
