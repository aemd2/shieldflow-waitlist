"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser } from "@/lib/db/queries";
import { validateKey, fetchActivity, LinearError } from "@/lib/linear";
import { linearTokenSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/audit";
import { fileIntegrationCsv, disconnectProvider, INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { encryptSecret, decryptSecret, isEncryptionConfigured, ENCRYPTION_NOT_CONFIGURED } from "@/lib/crypto";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

export async function connectLinear(input: { token: string }) {
  const parsed = linearTokenSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid key." };

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
  if (!isEncryptionConfigured()) return { error: ENCRYPTION_NOT_CONFIGURED };

  let who: string;
  try {
    who = await validateKey(parsed.data.token);
  } catch (err) {
    return { error: err instanceof LinearError ? err.userMessage : "Couldn't reach Linear." };
  }

  const { error } = await supabase.from("integrations").upsert(
    {
      company_id: company.id,
      provider: "linear",
      access_token: encryptSecret(parsed.data.token),
      status: "connected",
      connected_by: user.id,
      metadata: { account: who },
    },
    { onConflict: "company_id,provider" },
  );
  if (error) return { error: DB_ERROR };

  await logEvent(supabase, company.id, "integration.connected", {
    type: "integration",
    id: "linear",
    label: INTEGRATION_LABELS.linear,
    metadata: { account: who },
  });

  revalidatePath("/integrations");
  return { ok: true, account: who };
}

export async function syncLinear() {
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

  if (!checkRateLimit(`linear-sync:${company.id}`, 1, 60_000)) {
    return { error: "Already synced recently — try again in a minute." };
  }

  const { data: integ } = await supabase
    .from("integrations")
    .select("id, access_token, status")
    .eq("company_id", company.id)
    .eq("provider", "linear")
    .maybeSingle();
  if (!integ?.access_token || integ.status === "disconnected") {
    return { error: "Linear isn't connected yet." };
  }

  let token: string;
  try {
    token = decryptSecret(integ.access_token);
  } catch {
    return { error: "Stored Linear key is unreadable — please reconnect." };
  }

  try {
    const r = await fetchActivity(token);
    const csv = [
      `# Linear issue-tracking report`,
      `# Generated: ${new Date().toISOString()}`,
      `# Company: ${company.name}`,
      `# Summary: ${r.teams} teams | ${r.issuesSampled} recent issues sampled (${r.completed} closed, ${r.open} open)`,
      ``,
      `metric,value`,
      `Teams,${r.teams}`,
      `Recent issues sampled,${r.issuesSampled}`,
      `Closed/cancelled,${r.completed}`,
      `Open,${r.open}`,
    ].join("\n");

    const filed = await fileIntegrationCsv({
      supabase,
      companyId: company.id,
      userId: user.id,
      integrationId: integ.id,
      fileBase: "linear-issue-tracking",
      csv,
      note: `Automated Linear sync: ${r.teams} teams, ${r.issuesSampled} recent issues sampled.`,
    });
    if (filed.error) return { error: filed.error };

    revalidatePath("/integrations");
    revalidatePath("/evidence");
    return { ok: true, summary: { teams: r.teams, issues: r.issuesSampled } };
  } catch (err) {
    if (err instanceof LinearError) {
      if (err.kind === "auth") {
        await supabase.from("integrations").update({ status: "error" }).eq("id", integ.id);
        revalidatePath("/integrations");
      }
      return { error: err.userMessage };
    }
    return { error: "Sync failed. Please try again." };
  }
}

export async function disconnectLinear() {
  return disconnectProvider("linear");
}
