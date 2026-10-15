import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckDef, CheckOutcome, ExceptionRow } from "@/lib/checks-core";
import type { IdentityAccount } from "@/lib/identity-checks";

/**
 * How a deep integration hands its work to the rest of the product. A provider
 * module collects (network), evaluates (pure, via lib/checks-core), and returns a
 * ProviderScan. The scan is stored on its integrations row (`last_scan`) for the
 * provider page, and turned into RawChecks for control_checks / findings / history.
 */

export interface ProviderRoster {
  /** Accounts that can still sign in — leavers are looked for here. */
  all: IdentityAccount[];
  /** The humans among them — unknown logins are looked for here. */
  humans: IdentityAccount[];
  truncated: boolean;
  /** Why the list may be incomplete (missing permission, not an organisation…). */
  blindSpot: string | null;
}

export interface ProviderScan<X = Record<string, unknown>> {
  /** Check-provider key (the prefix of every check key: github, google, okta…). */
  provider: string;
  scannedAt: string;
  durationMs: number;
  results: CheckOutcome[];
  /** Provider-specific detail the page shows (repos, people, devices, apps…). */
  extra: X;
  /** People for the leaver / unknown-login engine, when the provider has them. */
  roster?: ProviderRoster | null;
}

export function isProviderScan(p: unknown): p is ProviderScan {
  return Boolean(p && typeof p === "object" && Array.isArray((p as ProviderScan).results) && typeof (p as ProviderScan).scannedAt === "string");
}

/** The workspace's live out-of-scope decisions for one provider's checks. */
export async function loadExceptions(db: SupabaseClient, companyId: string, provider: string): Promise<ExceptionRow[]> {
  const { data } = await db
    .from("check_exceptions")
    .select("check_key, resource_id, reason, expires_at")
    .eq("company_id", companyId)
    .like("check_key", `${provider}.%`);
  return (data ?? []).map((e) => ({
    checkKey: e.check_key as string,
    resourceId: e.resource_id as string,
    reason: e.reason as string,
    expiresAt: (e.expires_at as string | null) ?? null,
  }));
}

/** Keep the scan for the provider page. Best-effort: the checks stand without it. */
export async function saveScan(db: SupabaseClient, integrationId: string, scan: ProviderScan): Promise<void> {
  await db.from("integrations").update({ last_scan: scan }).eq("id", integrationId);
}

/** Outcomes → the checks engine's RawChecks; informational checks never reach a control. */
export function outcomesToRaw(results: CheckOutcome[], catalog: CheckDef[]) {
  const byKey = new Map(catalog.map((d) => [d.key, d]));
  return results.map((r) => {
    const def = byKey.get(r.key);
    return {
      checkKey: r.key,
      controlCodes: def && !def.informational ? def.controlCodes : [],
      result: r.result,
      detail: r.detail,
      ...(r.resources.length ? { resources: r.resources, subjects: r.resources.map((x) => x.label).slice(0, 20) } : {}),
      failingCount: r.failingCount,
      ...(r.costPerMonth ? { costPerMonth: r.costPerMonth } : {}),
    };
  });
}

/** A provider's workspace settings (on integrations.metadata.settings), with defaults. */
export function settingsOf<T extends Record<string, unknown>>(metadata: unknown, defaults: T): T {
  const s = ((metadata as { settings?: Partial<T> } | null)?.settings ?? {}) as Partial<T>;
  return { ...defaults, ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== null)) } as T;
}
