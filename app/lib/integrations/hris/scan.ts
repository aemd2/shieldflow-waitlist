import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { ok } from "@/lib/checks-core";
import { HrisError, hrState, readHris, type HrEmployee, type HrisProvider } from "@/lib/integrations/hris/clients";
import { evaluateHris } from "@/lib/integrations/hris/evaluate";
import { syncPersonnel, type SyncResult } from "@/lib/integrations/hris/sync";
import { loadExceptions, saveScan, settingsOf, type ProviderScan } from "@/lib/integrations/scan-store";

export const HRIS_DEFAULTS = { trainingDays: 30 };

export interface HrisExtra {
  employees: (HrEmployee & { state: "active" | "leaving" | "left"; trained: boolean | null })[];
  truncated: boolean;
  missingFields: string[];
  sync: SyncResult;
  settings: typeof HRIS_DEFAULTS;
}

export interface HrisIntegrationRow {
  id: string;
  company_id: string;
  access_token: string | null;
  metadata: Record<string, unknown> | null;
}

/** Read the HR system, bring Personnel up to date, check the records. */
export async function scanHris(db: SupabaseClient, provider: HrisProvider, integ: HrisIntegrationRow): Promise<ProviderScan<HrisExtra>> {
  let creds: unknown;
  try {
    creds = JSON.parse(decryptSecret(integ.access_token ?? ""));
  } catch {
    throw new HrisError("auth", "Stored credentials are unreadable — please reconnect.");
  }
  const started = Date.now();
  const settings = settingsOf(integ.metadata, HRIS_DEFAULTS);
  const read = await readHris(provider, creds);
  // Personnel first: the leaver checks everywhere else read it.
  const sync = await syncPersonnel(db, integ.company_id, provider, read.employees);

  const [exceptions, { data: training, error: trainingErr }] = await Promise.all([
    loadExceptions(db, integ.company_id, provider),
    db.from("training_records").select("person_email, status").eq("company_id", integ.company_id),
  ]);
  const trained = trainingErr ? null : ((training ?? []) as { person_email: string | null; status: string }[]).filter((t) => t.person_email).map((t) => ({ email: t.person_email!.toLowerCase(), completed: t.status === "completed" }));
  const now = new Date();
  const results = evaluateHris(provider, ok(read.employees), read.truncated, read.missingFields, { now, exceptions, training: trained, trainingDays: settings.trainingDays });

  const done = new Set((trained ?? []).filter((t) => t.completed).map((t) => t.email));
  const today = now.toISOString().slice(0, 10);
  const scan: ProviderScan<HrisExtra> = {
    provider,
    scannedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    results,
    roster: null,
    extra: {
      employees: read.employees.slice(0, 3000).map((e) => ({ ...e, state: hrState(e, today), trained: e.email && trained ? done.has(e.email) : null })),
      truncated: read.truncated,
      missingFields: read.missingFields,
      sync,
      settings,
    },
  };
  await saveScan(db, integ.id, scan);
  return scan;
}
