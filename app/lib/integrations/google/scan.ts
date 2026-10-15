import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureGoogleAccessToken, type GoogleTokenRow } from "@/lib/google";
import { collectGoogle } from "@/lib/integrations/google/collect";
import { evaluateGoogle, isLive } from "@/lib/integrations/google/evaluate";
import type { GApp, GUser } from "@/lib/integrations/google/types";
import { loadExceptions, saveScan, settingsOf, type ProviderRoster, type ProviderScan } from "@/lib/integrations/scan-store";
import { toIdentityAccount } from "@/lib/integrations/people-match";

export const GOOGLE_DEFAULTS = { dormantDays: 90 };
export type GoogleSettings = typeof GOOGLE_DEFAULTS;

export interface GoogleExtra {
  domain: string | null;
  users: GUser[];
  truncated: boolean;
  /** null = the audit-log permission isn't granted yet (reconnect to add it). */
  apps: GApp[] | null;
  appsError: string | null;
  appsWindowDays: number;
  settings: GoogleSettings;
}

export interface GoogleIntegrationRow extends GoogleTokenRow {
  company_id: string;
  metadata: Record<string, unknown> | null;
}

export async function scanGoogle(db: SupabaseClient, integ: GoogleIntegrationRow): Promise<ProviderScan<GoogleExtra>> {
  const token = await ensureGoogleAccessToken(db, integ);
  const settings = settingsOf(integ.metadata, GOOGLE_DEFAULTS);
  const [posture, exceptions] = await Promise.all([collectGoogle(token), loadExceptions(db, integ.company_id, "google")]);
  const results = evaluateGoogle(posture, { now: new Date(), exceptions, dormantDays: settings.dormantDays });

  const users = posture.users.ok ? posture.users.data : [];
  const roster: ProviderRoster = {
    // Every address that reaches the account, so Personnel can hold either.
    all: users.map((u) => toIdentityAccount(u.email, isLive(u), [u.email, ...u.aliases])),
    humans: users.map((u) => toIdentityAccount(u.email, isLive(u), [u.email, ...u.aliases])),
    truncated: posture.truncated,
    blindSpot: null,
  };

  const scan: ProviderScan<GoogleExtra> = {
    provider: "google",
    scannedAt: posture.scannedAt,
    durationMs: posture.durationMs,
    results,
    roster,
    extra: {
      domain: posture.domain,
      users: users.slice(0, 2000),
      truncated: posture.truncated,
      apps: posture.apps?.ok ? posture.apps.data.slice(0, 300) : null,
      appsError: posture.apps && !posture.apps.ok ? posture.apps.message : null,
      appsWindowDays: posture.appsWindowDays,
      settings,
    },
  };
  await saveScan(db, integ.id, scan);
  return scan;
}
