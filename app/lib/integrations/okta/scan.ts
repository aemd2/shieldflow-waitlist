import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { OktaError } from "@/lib/okta";
import { collectOkta, type OktaUserView } from "@/lib/integrations/okta/collect";
import { canSignIn, evaluateOkta } from "@/lib/integrations/okta/evaluate";
import type { SsoAppSummary } from "@/lib/identity-checks";
import { loadExceptions, saveScan, settingsOf, type ProviderRoster, type ProviderScan } from "@/lib/integrations/scan-store";
import { toIdentityAccount } from "@/lib/integrations/people-match";

export const OKTA_DEFAULTS = { dormantDays: 90 };

export interface OktaExtra {
  host: string;
  users: OktaUserView[];
  truncated: boolean;
  factorsIncomplete: boolean;
  passwordMinLength: number | null;
  apps: SsoAppSummary | null;
  unread: string[];
  settings: typeof OKTA_DEFAULTS;
}

export async function scanOkta(db: SupabaseClient, integ: { id: string; company_id: string; access_token: string | null; metadata: Record<string, unknown> | null }): Promise<ProviderScan<OktaExtra>> {
  let creds: { host: string; token: string };
  try {
    creds = JSON.parse(decryptSecret(integ.access_token ?? ""));
  } catch {
    throw new OktaError("auth", "Stored credentials are unreadable — please reconnect Okta.");
  }
  const settings = settingsOf(integ.metadata, OKTA_DEFAULTS);
  const [posture, exceptions] = await Promise.all([collectOkta(creds.host ?? (integ.metadata?.host as string) ?? "", creds.token), loadExceptions(db, integ.company_id, "okta")]);
  const results = evaluateOkta(posture, { now: new Date(), exceptions, dormantDays: settings.dormantDays });
  const users = posture.users.ok ? posture.users.data : [];
  const roster: ProviderRoster | null = posture.users.ok
    ? {
        // LOCKED_OUT and PASSWORD_EXPIRED still hold access and come back.
        all: users.map((u) => toIdentityAccount(u.email, canSignIn(u), [u.email])),
        humans: users.filter(canSignIn).map((u) => toIdentityAccount(u.email, true, [u.email])),
        truncated: posture.usersTruncated,
        blindSpot: null,
      }
    : null;
  const unread = [posture.users, posture.admins, posture.passwordMinLength].filter((s) => !s.ok).map((s) => (s as { message: string }).message);
  if (posture.factorsIncomplete) unread.push("some people's factors weren't read (Okta rate limit) — the next scan reads them");

  const scan: ProviderScan<OktaExtra> = {
    provider: "okta",
    scannedAt: posture.scannedAt,
    durationMs: posture.durationMs,
    results,
    roster,
    extra: {
      host: posture.host,
      users: users.slice(0, 2000),
      truncated: posture.usersTruncated,
      factorsIncomplete: posture.factorsIncomplete,
      passwordMinLength: posture.passwordMinLength.ok ? posture.passwordMinLength.data : null,
      apps: posture.apps,
      unread,
      settings,
    },
  };
  await saveScan(db, integ.id, scan);
  return scan;
}
