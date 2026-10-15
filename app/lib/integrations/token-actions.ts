import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { assertFeature, assertIntegrationSlot } from "@/lib/plan-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/audit";
import { fileIntegrationCsv, INTEGRATION_LABELS } from "@/lib/integration-evidence";
import { recordChecksForSync } from "@/lib/checks";
import { encryptSecret, isEncryptionConfigured, ENCRYPTION_NOT_CONFIGURED } from "@/lib/crypto";
import type { CheckDef } from "@/lib/checks-core";
import type { ProviderScan } from "@/lib/integrations/scan-store";

/**
 * The connect / scan plumbing every paste-a-credential integration shares (the
 * HR systems, the device managers): who may, plan limits, encryption, the
 * evidence CSV, the checks. Each provider supplies only how to validate its
 * credentials and how to scan.
 */

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";
type Db = Awaited<ReturnType<typeof createServerSupabase>>;
type UserError = Error & { userMessage?: string; kind?: string };

async function session(gate: "connect" | "scan", provider: string) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const company = await getCompanyForUser(supabase, user.id).catch(() => undefined);
  if (company === undefined) return { error: DB_ERROR } as const;
  if (!company) return { error: "No company found." } as const;
  const denied =
    (await assertCanWrite(supabase, company.id, user.id)) ??
    (gate === "connect" ? await assertIntegrationSlot(supabase, company.id, provider) : await assertFeature(supabase, company.id, "integrations"));
  if (denied) return { error: denied } as const;
  return { supabase, company, userId: user.id } as const;
}

export async function connectWithCredentials(
  provider: string,
  creds: Record<string, string>,
  validate: () => Promise<{ label: string; metadata?: Record<string, unknown> }>,
): Promise<{ ok?: true; org?: string; error?: string }> {
  const s = await session("connect", provider);
  if ("error" in s) return { error: s.error };
  if (!isEncryptionConfigured()) return { error: ENCRYPTION_NOT_CONFIGURED };
  let v: { label: string; metadata?: Record<string, unknown> };
  try {
    v = await validate();
  } catch (err) {
    return { error: (err as UserError).userMessage ?? `Couldn't reach ${INTEGRATION_LABELS[provider] ?? provider}.` };
  }
  const { data: existing } = await s.supabase.from("integrations").select("metadata").eq("company_id", s.company.id).eq("provider", provider).maybeSingle();
  const { error } = await s.supabase.from("integrations").upsert(
    {
      company_id: s.company.id,
      provider,
      access_token: encryptSecret(JSON.stringify(creds)),
      status: "connected",
      connected_by: s.userId,
      metadata: { ...((existing?.metadata as Record<string, unknown> | null) ?? {}), org: v.label, ...(v.metadata ?? {}) },
    },
    { onConflict: "company_id,provider" },
  );
  if (error) return { error: DB_ERROR };
  await logEvent(s.supabase, s.company.id, "integration.connected", { type: "integration", id: provider, label: INTEGRATION_LABELS[provider] ?? provider, metadata: { org: v.label } });
  revalidatePath("/integrations");
  return { ok: true, org: v.label };
}

export async function scanWithCredentials<X>(
  provider: string,
  catalog: CheckDef[],
  scan: (db: Db, integ: { id: string; company_id: string; access_token: string | null; metadata: Record<string, unknown> | null }) => Promise<ProviderScan<X>>,
  report: (scan: ProviderScan<X>, companyName: string) => { csv: string; note: string; summary: Record<string, unknown> },
  afterward?: (db: Db, companyId: string, userId: string, scan: ProviderScan<X>) => Promise<void>,
): Promise<{ ok?: true; pass?: number; fail?: number; inconclusive?: number; summary?: Record<string, unknown>; error?: string }> {
  const s = await session("scan", provider);
  if ("error" in s) return { error: s.error };
  if (!checkRateLimit(`${provider}-sync:${s.company.id}`, 1, 60_000)) return { error: "Already scanned recently — try again in a minute." };
  const { data: integ } = await s.supabase.from("integrations").select("id, company_id, access_token, status, metadata").eq("company_id", s.company.id).eq("provider", provider).maybeSingle();
  if (!integ?.access_token || integ.status === "disconnected") return { error: `${INTEGRATION_LABELS[provider] ?? provider} isn't connected yet.` };

  let result: ProviderScan<X>;
  try {
    result = await scan(s.supabase, integ as never);
  } catch (err) {
    const e = err as UserError;
    if (e.kind === "auth") {
      await s.supabase.from("integrations").update({ status: "error" }).eq("id", integ.id);
      revalidatePath("/integrations");
    }
    return { error: e.userMessage ?? "The scan failed. Please try again." };
  }

  const r = report(result, s.company.name);
  const filed = await fileIntegrationCsv({ supabase: s.supabase, companyId: s.company.id, userId: s.userId, integrationId: integ.id, fileBase: `${provider}-report`, csv: r.csv, note: r.note });
  if (filed.error) await s.supabase.from("integrations").update({ last_synced_at: new Date().toISOString(), status: "connected" }).eq("id", integ.id);
  if (afterward) await afterward(s.supabase, s.company.id, s.userId, result).catch(() => undefined);
  await recordChecksForSync(s.supabase, s.company.id, provider, result, filed.evidenceId ?? null);

  revalidatePath("/integrations");
  revalidatePath(`/integrations/${provider}`);
  revalidatePath("/evidence");
  revalidatePath("/personnel");
  revalidatePath("/dashboard");
  const informational = new Set(catalog.filter((c) => c.informational).map((c) => c.key));
  const counts = { pass: 0, fail: 0, inconclusive: 0 };
  for (const x of result.results) if (!informational.has(x.key)) counts[x.result]++;
  return { ok: true, ...counts, summary: r.summary };
}
