"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { validateToken, fetchRepoSecurity, GitLabError } from "@/lib/gitlab";
import { gitlabTokenSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { csvSafe } from "@/lib/csv";
import { logEvent } from "@/lib/audit";
import { fileIntegrationCsv, disconnectProvider, INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { recordChecksForSync } from "@/lib/checks";
import { encryptSecret, decryptSecret, isEncryptionConfigured, ENCRYPTION_NOT_CONFIGURED } from "@/lib/crypto";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

export async function connectGitLab(input: { token: string }) {
  const parsed = gitlabTokenSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid token." };

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

  let username: string;
  try {
    username = await validateToken(parsed.data.token);
  } catch (err) {
    return { error: err instanceof GitLabError ? err.userMessage : "Couldn't reach GitLab." };
  }

  const { error } = await supabase.from("integrations").upsert(
    {
      company_id: company.id,
      provider: "gitlab",
      access_token: encryptSecret(parsed.data.token),
      status: "connected",
      connected_by: user.id,
      metadata: { username },
    },
    { onConflict: "company_id,provider" },
  );
  if (error) return { error: DB_ERROR };

  await logEvent(supabase, company.id, "integration.connected", {
    type: "integration",
    id: "gitlab",
    label: INTEGRATION_LABELS.gitlab,
    metadata: { username },
  });

  revalidatePath("/integrations");
  return { ok: true, username };
}

export async function syncGitLab() {
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

  if (!checkRateLimit(`gitlab-sync:${company.id}`, 1, 60_000)) {
    return { error: "Already synced recently — try again in a minute." };
  }

  const { data: integ } = await supabase
    .from("integrations")
    .select("id, access_token, status")
    .eq("company_id", company.id)
    .eq("provider", "gitlab")
    .maybeSingle();
  if (!integ?.access_token || integ.status === "disconnected") {
    return { error: "GitLab isn't connected yet." };
  }

  let token: string;
  try {
    token = decryptSecret(integ.access_token);
  } catch {
    return { error: "Stored GitLab token is unreadable — please reconnect." };
  }

  try {
    const r = await fetchRepoSecurity(token);
    const csv = [
      `# GitLab repository security report`,
      `# Generated: ${new Date().toISOString()}`,
      `# Company: ${company.name}`,
      `# Summary: ${r.total} projects | ${r.protectedCount} with protected branches | ${r.publicCount} public${r.truncated ? " | partial (large account or rate limit)" : ""}`,
      ``,
      `project,visibility,branch_protection`,
      ...r.repos.map((p) => `${csvSafe(p.fullPath)},${p.visibility},${p.branchProtection}`),
    ].join("\n");

    const filed = await fileIntegrationCsv({
      supabase,
      companyId: company.id,
      userId: user.id,
      integrationId: integ.id,
      fileBase: "gitlab-repo-security",
      csv,
      note: `Automated GitLab sync: ${r.total} projects, ${r.protectedCount} with protected branches, ${r.publicCount} public.`,
    });
    if (filed.error) return { error: filed.error };

    await recordChecksForSync(supabase, company.id, "gitlab", r, filed.evidenceId ?? null);

    revalidatePath("/integrations");
    revalidatePath("/evidence");
    revalidatePath("/dashboard");
    return { ok: true, summary: { total: r.total, protected: r.protectedCount, public: r.publicCount } };
  } catch (err) {
    if (err instanceof GitLabError) {
      if (err.kind === "auth") {
        await supabase.from("integrations").update({ status: "error" }).eq("id", integ.id);
        revalidatePath("/integrations");
      }
      return { error: err.userMessage };
    }
    return { error: "Sync failed. Please try again." };
  }
}

export async function disconnectGitLab() {
  return disconnectProvider("gitlab");
}
