"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { assertFeature, assertIntegrationSlot } from "@/lib/plan-server";
import {
  normalizeTenantId,
  validateCredentials,
  MicrosoftError,
  type MicrosoftCredentials,
} from "@/lib/microsoft";
import { microsoftSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { csvSafe } from "@/lib/csv";
import { logEvent } from "@/lib/audit";
import { fileIntegrationCsv, disconnectProvider, INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { recordChecksForSync } from "@/lib/checks";
import { z } from "zod";
import { scanMicrosoft, type MicrosoftIntegrationRow } from "@/lib/integrations/microsoft/scan";
import { MICROSOFT_CHECK_BY_KEY } from "@/lib/integrations/microsoft/catalog";
import { csvRow, fileMeasureCsv } from "@/lib/evidence-population";
import { encryptSecret, isEncryptionConfigured, ENCRYPTION_NOT_CONFIGURED } from "@/lib/crypto";

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
    .select("id, company_id, access_token, status, metadata")
    .eq("company_id", company.id)
    .eq("provider", "microsoft")
    .maybeSingle();
  if (!integ?.access_token || integ.status === "disconnected") {
    return { error: "Microsoft 365 isn't connected yet." };
  }

  try {
    const scan = await scanMicrosoft(supabase, integ as MicrosoftIntegrationRow);
    const x = scan.extra;
    const enabled = x.users.filter((u) => u.enabled);
    const lines = [
      `# Microsoft 365 / Entra ID security report`,
      `# Generated: ${new Date().toISOString()}`,
      `# Company: ${company.name}`,
      `# Summary: ${x.users.length} accounts (${enabled.length} enabled, ${x.users.filter((u) => u.guest).length} guests)` +
        ` | MFA required by: ${x.securityDefaults ? "Security Defaults" : x.enforcing ? `Conditional Access “${x.enforcing}”` : "nothing found"}` +
        (x.truncated ? ` | TRUNCATED — more accounts exist than were read` : ``),
      ...(x.unread.length ? [`# Not read: ${x.unread.join("; ")}`] : []),
      ``,
      `user_principal_name,email,display_name,enabled,guest,mfa_registered,admin_roles`,
      ...x.users.map((u) =>
        [csvSafe(u.upn), csvSafe(u.mail ?? ""), csvSafe(u.name ?? ""), u.enabled ? "yes" : "no", u.guest ? "yes" : "no", u.mfa === null ? "unknown" : u.mfa ? "yes" : "no", csvSafe(u.roles.join("; "))].join(","),
      ),
      ...(x.devices
        ? [
            ``,
            `device,os,os_version,encrypted,last_check_in,owner`,
            ...x.devices.map((d) =>
              [csvSafe(d.name), csvSafe(d.os), csvSafe(d.osVersion ?? ""), d.encrypted === null ? "unknown" : d.encrypted ? "yes" : "no", d.lastSeen ?? "never", csvSafe(d.owner ?? "")].join(","),
            ),
          ]
        : []),
    ].join("\n");

    const filed = await fileIntegrationCsv({
      supabase,
      companyId: company.id,
      userId: user.id,
      integrationId: integ.id,
      fileBase: "microsoft-security",
      csv: lines,
      note: `Automated Microsoft 365 scan: ${enabled.length} enabled accounts${x.devices ? `, ${x.devices.length} Intune devices` : ""}.`,
    });
    if (filed.error) return { error: filed.error };

    if (x.devices?.length) {
      const day = new Date().toISOString().slice(0, 10);
      await fileMeasureCsv(
        supabase,
        company.id,
        user.id,
        "endpoint-protection",
        `intune-devices-${day}.csv`,
        [
          csvRow(`# Devices managed by Intune — ${day}`),
          csvRow("device", "os", "os_version", "encrypted", "last_check_in", "owner", "company_owned"),
          ...x.devices.map((d) => csvRow(d.name, d.os, d.osVersion, d.encrypted ?? "unknown", d.lastSeen ?? "never", d.owner, d.corporate ?? "unknown")),
        ].join("\n"),
        "Generated from Microsoft Intune by ShieldFlow: every managed device, its disk encryption and last check-in.",
      );
    }

    await recordChecksForSync(supabase, company.id, "microsoft", scan, filed.evidenceId ?? null);

    revalidatePath("/integrations");
    revalidatePath("/integrations/microsoft");
    revalidatePath("/evidence");
    revalidatePath("/personnel");
    revalidatePath("/dashboard");
    const counts = { pass: 0, fail: 0, inconclusive: 0 };
    for (const r of scan.results) if (!MICROSOFT_CHECK_BY_KEY.get(r.key)?.informational) counts[r.result]++;
    return { ok: true, ...counts, summary: { total: x.users.length, enabled: enabled.length, disabled: x.users.length - enabled.length } };
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

const settingsSchema = z.object({ staleDays: z.number().int().min(3).max(90) }).partial();

/** Change the Microsoft settings (device check-in window); the rest stay as they were. */
export async function updateMicrosoftSettings(input: unknown) {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: "The check-in window must be 3–90 days." };
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const company = await getCompanyForUser(supabase, user.id).catch(() => null);
  if (!company) return { error: "No company found." };
  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { error: denied };
  const { data: integ } = await supabase.from("integrations").select("id, metadata").eq("company_id", company.id).eq("provider", "microsoft").maybeSingle();
  if (!integ) return { error: "Microsoft 365 isn't connected yet." };
  const meta = (integ.metadata as Record<string, unknown> | null) ?? {};
  const current = (meta.settings as Record<string, unknown> | undefined) ?? {};
  const { error } = await supabase.from("integrations").update({ metadata: { ...meta, settings: { ...current, ...parsed.data } } }).eq("id", integ.id);
  if (error) return { error: DB_ERROR };
  revalidatePath("/integrations/microsoft");
  return { ok: true };
}

export async function disconnectMicrosoft() {
  return disconnectProvider("microsoft");
}
