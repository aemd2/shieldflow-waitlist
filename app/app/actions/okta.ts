"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser } from "@/lib/db/queries";
import { normalizeOktaHost, validateToken, fetchUserSecurity, OktaError } from "@/lib/okta";
import { oktaSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { csvSafe } from "@/lib/csv";
import { logEvent } from "@/lib/audit";
import { fileIntegrationCsv, disconnectProvider, INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { recordChecksForSync } from "@/lib/checks";
import { encryptSecret, decryptSecret, isEncryptionConfigured, ENCRYPTION_NOT_CONFIGURED } from "@/lib/crypto";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

export async function connectOkta(input: { domain: string; token: string }) {
  const parsed = oktaSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const host = normalizeOktaHost(parsed.data.domain);
  if (!host) return { error: "Enter your Okta domain, e.g. acme.okta.com." };

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

  let org: string;
  try {
    org = await validateToken(host, parsed.data.token);
  } catch (err) {
    return { error: err instanceof OktaError ? err.userMessage : "Couldn't reach Okta." };
  }

  const { error } = await supabase.from("integrations").upsert(
    {
      company_id: company.id,
      provider: "okta",
      access_token: encryptSecret(JSON.stringify({ host, token: parsed.data.token })),
      status: "connected",
      connected_by: user.id,
      metadata: { org },
    },
    { onConflict: "company_id,provider" },
  );
  if (error) return { error: DB_ERROR };

  await logEvent(supabase, company.id, "integration.connected", {
    type: "integration",
    id: "okta",
    label: INTEGRATION_LABELS.okta,
    metadata: { org },
  });

  revalidatePath("/integrations");
  return { ok: true, org };
}

export async function syncOkta() {
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

  if (!checkRateLimit(`okta-sync:${company.id}`, 1, 60_000)) {
    return { error: "Already synced recently — try again in a minute." };
  }

  const { data: integ } = await supabase
    .from("integrations")
    .select("id, access_token, status")
    .eq("company_id", company.id)
    .eq("provider", "okta")
    .maybeSingle();
  if (!integ?.access_token || integ.status === "disconnected") {
    return { error: "Okta isn't connected yet." };
  }

  let creds: { host: string; token: string };
  try {
    creds = JSON.parse(decryptSecret(integ.access_token));
  } catch {
    return { error: "Stored credentials are corrupt — please reconnect." };
  }

  try {
    const r = await fetchUserSecurity(creds.host, creds.token);
    const csv = [
      `# Okta identity security report`,
      `# Generated: ${new Date().toISOString()}`,
      `# Company: ${company.name}`,
      `# Summary: ${r.totalUsers} users (${r.active} active, ${r.suspended} suspended, ${r.deprovisioned} deprovisioned) | MFA ${r.mfaEnrolled}/${r.mfaChecked} checked | min password length ${r.passwordMinLength ?? "n/a"}`,
      ``,
      `metric,value`,
      `Total users,${r.totalUsers}`,
      `Active users,${r.active}`,
      `Suspended users,${r.suspended}`,
      `Deprovisioned users,${r.deprovisioned}`,
      `Active users checked for MFA,${r.mfaChecked}`,
      `...with active MFA,${r.mfaEnrolled}`,
      `Password minimum length,${r.passwordMinLength ?? "—"}`,
      `Password complexity required,${csvSafe(r.passwordRequiresComplexity ? "Yes" : "No")}`,
    ].join("\n");

    const filed = await fileIntegrationCsv({
      supabase,
      companyId: company.id,
      userId: user.id,
      integrationId: integ.id,
      fileBase: "okta-identity-security",
      csv,
      note: `Automated Okta sync: ${r.totalUsers} users, ${r.mfaEnrolled}/${r.mfaChecked} checked with MFA.`,
    });
    if (filed.error) return { error: filed.error };

    await recordChecksForSync(supabase, company.id, "okta", r, filed.evidenceId ?? null);

    revalidatePath("/integrations");
    revalidatePath("/evidence");
    revalidatePath("/dashboard");
    return { ok: true, summary: { users: r.totalUsers, mfa: r.mfaEnrolled, mfaChecked: r.mfaChecked } };
  } catch (err) {
    if (err instanceof OktaError) {
      if (err.kind === "auth") {
        await supabase.from("integrations").update({ status: "error" }).eq("id", integ.id);
        revalidatePath("/integrations");
      }
      return { error: err.userMessage };
    }
    return { error: "Sync failed. Please try again." };
  }
}

export async function disconnectOkta() {
  return disconnectProvider("okta");
}
