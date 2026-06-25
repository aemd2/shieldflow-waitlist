"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser } from "@/lib/db/queries";
import { validateToken, fetchZoneSecurity, CloudflareError } from "@/lib/cloudflare";
import { cloudflareTokenSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { csvSafe } from "@/lib/csv";
import { logEvent } from "@/lib/audit";
import { fileIntegrationCsv, disconnectProvider, INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { recordChecksForSync } from "@/lib/checks";
import { encryptSecret, decryptSecret, isEncryptionConfigured, ENCRYPTION_NOT_CONFIGURED } from "@/lib/crypto";

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

  if (!checkRateLimit(`cloudflare-sync:${company.id}`, 1, 60_000)) {
    return { error: "Already synced recently — try again in a minute." };
  }

  const { data: integ } = await supabase
    .from("integrations")
    .select("id, access_token, status")
    .eq("company_id", company.id)
    .eq("provider", "cloudflare")
    .maybeSingle();
  if (!integ?.access_token || integ.status === "disconnected") {
    return { error: "Cloudflare isn't connected yet." };
  }

  let token: string;
  try {
    token = decryptSecret(integ.access_token);
  } catch {
    return { error: "Stored Cloudflare token is unreadable — please reconnect." };
  }

  try {
    const r = await fetchZoneSecurity(token);
    const csv = [
      `# Cloudflare zone security report`,
      `# Generated: ${new Date().toISOString()}`,
      `# Company: ${company.name}`,
      `# Summary: ${r.totalZones} zones${r.truncated ? " (first 25 detailed)" : ""}`,
      ``,
      `zone,ssl_mode,min_tls_version,always_use_https`,
      ...r.zones.map(
        (z) => `${csvSafe(z.name)},${csvSafe(z.ssl)},${csvSafe(z.minTls)},${csvSafe(z.alwaysHttps)}`,
      ),
    ].join("\n");

    const filed = await fileIntegrationCsv({
      supabase,
      companyId: company.id,
      userId: user.id,
      integrationId: integ.id,
      fileBase: "cloudflare-zone-security",
      csv,
      note: `Automated Cloudflare sync: ${r.totalZones} zones, SSL/TLS posture captured.`,
    });
    if (filed.error) return { error: filed.error };

    await recordChecksForSync(supabase, company.id, "cloudflare", r, filed.evidenceId ?? null);

    revalidatePath("/integrations");
    revalidatePath("/evidence");
    revalidatePath("/dashboard");
    return { ok: true, summary: { zones: r.totalZones } };
  } catch (err) {
    if (err instanceof CloudflareError) {
      if (err.kind === "auth") {
        await supabase.from("integrations").update({ status: "error" }).eq("id", integ.id);
        revalidatePath("/integrations");
      }
      return { error: err.userMessage };
    }
    return { error: "Sync failed. Please try again." };
  }
}

export async function disconnectCloudflare() {
  return disconnectProvider("cloudflare");
}
