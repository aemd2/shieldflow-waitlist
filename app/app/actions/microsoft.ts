"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { assertFeature, assertIntegrationSlot } from "@/lib/plan-server";
import {
  normalizeTenantId,
  validateCredentials,
  fetchDirectorySecurity,
  MicrosoftError,
  type MicrosoftCredentials,
} from "@/lib/microsoft";
import { microsoftSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { csvSafe } from "@/lib/csv";
import { logEvent } from "@/lib/audit";
import { fileIntegrationCsv, disconnectProvider, INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { recordChecksForSync } from "@/lib/checks";
import { encryptSecret, decryptSecret, isEncryptionConfigured, ENCRYPTION_NOT_CONFIGURED } from "@/lib/crypto";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

export async function connectMicrosoft(input: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}) {
  const parsed = microsoftSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const tenantId = normalizeTenantId(parsed.data.tenantId);
  if (!tenantId) {
    return { error: "Enter your tenant ID (a GUID) or domain, e.g. contoso.onmicrosoft.com." };
  }

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
  const denied =
    (await assertCanWrite(supabase, company.id, user.id)) ??
    (await assertIntegrationSlot(supabase, company.id, "microsoft"));
  if (denied) return { error: denied };
  if (!isEncryptionConfigured()) return { error: ENCRYPTION_NOT_CONFIGURED };

  const creds: MicrosoftCredentials = {
    tenantId,
    clientId: parsed.data.clientId,
    clientSecret: parsed.data.clientSecret,
  };

  let org: string;
  try {
    org = await validateCredentials(creds);
  } catch (err) {
    return { error: err instanceof MicrosoftError ? err.userMessage : "Couldn't reach Microsoft." };
  }

  const { error } = await supabase.from("integrations").upsert(
    {
      company_id: company.id,
      provider: "microsoft",
      access_token: encryptSecret(JSON.stringify(creds)),
      status: "connected",
      connected_by: user.id,
      metadata: { org, tenant_id: tenantId },
    },
    { onConflict: "company_id,provider" },
  );
  if (error) return { error: DB_ERROR };

  await logEvent(supabase, company.id, "integration.connected", {
    type: "integration",
    id: "microsoft",
    label: INTEGRATION_LABELS.microsoft,
    metadata: { org },
  });

  revalidatePath("/integrations");
  return { ok: true, org };
}

export async function syncMicrosoft() {
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
  const denied =
    (await assertCanWrite(supabase, company.id, user.id)) ??
    (await assertFeature(supabase, company.id, "integrations"));
  if (denied) return { error: denied };

  if (!checkRateLimit(`microsoft-sync:${company.id}`, 1, 60_000)) {
    return { error: "Already synced recently — try again in a minute." };
  }

  const { data: integ } = await supabase
    .from("integrations")
    .select("id, access_token, status")
    .eq("company_id", company.id)
    .eq("provider", "microsoft")
    .maybeSingle();
  if (!integ?.access_token || integ.status === "disconnected") {
    return { error: "Microsoft 365 isn't connected yet." };
  }

  let creds: MicrosoftCredentials;
  try {
    creds = JSON.parse(decryptSecret(integ.access_token));
  } catch {
    return { error: "Stored credentials are corrupt — please reconnect." };
  }

  try {
    const r = await fetchDirectorySecurity(creds);
    const csv = [
      `# Microsoft 365 / Entra ID directory report`,
      `# Generated: ${new Date().toISOString()}`,
      `# Company: ${company.name}`,
      `# Summary: ${r.totalUsers} accounts (${r.enabled} enabled, ${r.disabled} disabled)` +
        (r.truncated ? ` | TRUNCATED — more accounts exist than were read` : ``),
      ``,
      `email,display_name,account_enabled`,
      ...r.roster.map(
        (u) => `${csvSafe(u.email)},${csvSafe(u.name ?? "")},${u.enabled ? "yes" : "no"}`,
      ),
    ].join("\n");

    const filed = await fileIntegrationCsv({
      supabase,
      companyId: company.id,
      userId: user.id,
      integrationId: integ.id,
      fileBase: "microsoft-directory",
      csv,
      note: `Automated Microsoft 365 sync: ${r.totalUsers} accounts, ${r.enabled} enabled.`,
    });
    if (filed.error) return { error: filed.error };

    await recordChecksForSync(supabase, company.id, "microsoft", r, filed.evidenceId ?? null);

    revalidatePath("/integrations");
    revalidatePath("/evidence");
    revalidatePath("/personnel");
    revalidatePath("/dashboard");
    return { ok: true, summary: { total: r.totalUsers, enabled: r.enabled, disabled: r.disabled } };
  } catch (err) {
    if (err instanceof MicrosoftError) {
      if (err.kind === "auth") {
        await supabase.from("integrations").update({ status: "error" }).eq("id", integ.id);
        revalidatePath("/integrations");
      }
      return { error: err.userMessage };
    }
    return { error: "Sync failed. Please try again." };
  }
}

export async function disconnectMicrosoft() {
  return disconnectProvider("microsoft");
}
