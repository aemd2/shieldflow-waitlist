"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { assertIntegrationSlot } from "@/lib/plan-server";
import { validateToken, CloudflareError } from "@/lib/cloudflare";
import { cloudflareTokenSchema } from "@/lib/validation";
import { logEvent } from "@/lib/audit";
import { disconnectProvider, INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { scanWithCredentials, checksReportCsv } from "@/lib/integrations/token-actions";
import { scanCloudflare } from "@/lib/integrations/cloudflare/scan";
import { CLOUDFLARE_CHECKS } from "@/lib/integrations/cloudflare/catalog";
import { csvRow } from "@/lib/evidence-population";
import { encryptSecret, isEncryptionConfigured, ENCRYPTION_NOT_CONFIGURED } from "@/lib/crypto";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

export async function connectCloudflare(input: { token: string }) {
  const parsed = cloudflareTokenSchema.safeParse(input);
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
  const denied =
    (await assertCanWrite(supabase, company.id, user.id)) ??
    (await assertIntegrationSlot(supabase, company.id, "cloudflare"));
  if (denied) return { error: denied };
  if (!isEncryptionConfigured()) return { error: ENCRYPTION_NOT_CONFIGURED };

  try {
    await validateToken(parsed.data.token);
  } catch (err) {
    return { error: err instanceof CloudflareError ? err.userMessage : "Couldn't reach Cloudflare." };
  }

  const { error } = await supabase.from("integrations").upsert(
    {
      company_id: company.id,
      provider: "cloudflare",
      access_token: encryptSecret(parsed.data.token),
      status: "connected",
      connected_by: user.id,
    },
    { onConflict: "company_id,provider" },
  );
  if (error) return { error: DB_ERROR };

  await logEvent(supabase, company.id, "integration.connected", {
    type: "integration",
    id: "cloudflare",
    label: INTEGRATION_LABELS.cloudflare,
  });

  revalidatePath("/integrations");
  return { ok: true };
}

export async function syncCloudflare() {
  return scanWithCredentials(
    "cloudflare",
    CLOUDFLARE_CHECKS,
    scanCloudflare,
    (scan, company) => {
      const zones = scan.extra.zones;
      return {
        csv: checksReportCsv("Cloudflare", company, scan, CLOUDFLARE_CHECKS, [
          csvRow("zone", "ssl", "min_tls", "always_https", "hsts", "dnssec"),
          ...zones.map((z) => csvRow(z.name, z.ssl ?? "unknown", z.minTls ?? "unknown", z.alwaysHttps ?? "unknown", z.hsts ?? "unknown", z.dnssec ?? "unknown")),
        ]),
        note: `Automated Cloudflare scan: ${zones.length} zones.`,
        summary: { zones: zones.length },
      };
    },
  );
}

export async function disconnectCloudflare() {
  return disconnectProvider("cloudflare");
}
