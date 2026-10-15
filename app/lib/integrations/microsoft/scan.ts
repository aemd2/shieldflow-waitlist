import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { MicrosoftError, type MicrosoftCredentials } from "@/lib/microsoft";
import { collectMicrosoft, type MsConsent, type MsRoleMember, type MsUser } from "@/lib/integrations/microsoft/collect";
import { evaluateMicrosoft } from "@/lib/integrations/microsoft/evaluate";
import type { Device } from "@/lib/integrations/devices";
import { loadExceptions, saveScan, settingsOf, type ProviderRoster, type ProviderScan } from "@/lib/integrations/scan-store";
import { toIdentityAccount } from "@/lib/integrations/people-match";

export const MICROSOFT_DEFAULTS = { staleDays: 14 };

export interface MicrosoftExtra {
  tenant: string;
  users: (MsUser & { mfa: boolean | null; roles: string[] })[];
  truncated: boolean;
  securityDefaults: boolean | null;
  enforcing: string | null;
  consents: MsConsent[] | null;
  admins: MsRoleMember[];
  /** null = Intune not available in this tenant. */
  devices: Device[] | null;
  /** Sections that couldn't be read, and why — shown on the page. */
  unread: string[];
  settings: typeof MICROSOFT_DEFAULTS;
}

export interface MicrosoftIntegrationRow {
  id: string;
  company_id: string;
  access_token: string | null;
  metadata: Record<string, unknown> | null;
}

export async function scanMicrosoft(db: SupabaseClient, integ: MicrosoftIntegrationRow): Promise<ProviderScan<MicrosoftExtra>> {
  let creds: MicrosoftCredentials;
  try {
    creds = JSON.parse(decryptSecret(integ.access_token ?? ""));
  } catch {
    throw new MicrosoftError("auth", "Stored credentials are unreadable — please reconnect Microsoft 365.");
  }
  const settings = settingsOf(integ.metadata, MICROSOFT_DEFAULTS);
  const [posture, exceptions, { data: people }] = await Promise.all([
    collectMicrosoft(creds),
    loadExceptions(db, integ.company_id, "microsoft"),
    db.from("personnel").select("name, email, status").eq("company_id", integ.company_id),
  ]);
  const staff = ((people ?? []) as { name: string; email: string | null; status: string }[]).filter((p) => p.email).map((p) => ({ name: p.name, email: p.email!, status: p.status }));
  const results = evaluateMicrosoft(posture, { now: new Date(), exceptions, staleDays: settings.staleDays, people: staff });

  const users = posture.users.ok ? posture.users.data : [];
  const addresses = (u: MsUser) => [...new Set([u.mail, u.upn].filter((x): x is string => Boolean(x)))];
  const roster: ProviderRoster | null = posture.users.ok
    ? {
        all: users.map((u) => toIdentityAccount(u.mail ?? u.upn, u.enabled, addresses(u))),
        // Guests are other companies' people: listed separately, never "unknown".
        humans: users.filter((u) => !u.guest).map((u) => toIdentityAccount(u.mail ?? u.upn, u.enabled, addresses(u))),
        truncated: posture.usersTruncated,
        blindSpot: null,
      }
    : null;

  const reg = new Map((posture.registration.ok ? posture.registration.data : []).map((r) => [r.upn, r.mfaRegistered]));
  const admins = posture.roles.ok ? posture.roles.data : [];
  const rolesOf = new Map<string, string[]>();
  for (const a of admins) rolesOf.set(a.member, [...(rolesOf.get(a.member) ?? []), a.role]);
  const ca = posture.conditionalAccess.ok ? posture.conditionalAccess.data.find((p) => p.state === "enabled" && p.mfaForAll) : undefined;
  const unread = [posture.users, posture.registration, posture.securityDefaults, posture.conditionalAccess, posture.roles, posture.consents, posture.devices]
    .filter((s): s is Exclude<typeof s, null | { ok: true }> => Boolean(s && !s.ok))
    .map((s) => s.message);

  const scan: ProviderScan<MicrosoftExtra> = {
    provider: "microsoft",
    scannedAt: posture.scannedAt,
    durationMs: posture.durationMs,
    results,
    roster,
    extra: {
      tenant: posture.tenant,
      users: users.slice(0, 3000).map((u) => ({ ...u, mfa: posture.registration.ok ? (reg.get(u.upn) ?? null) : null, roles: rolesOf.get(u.upn) ?? [] })),
      truncated: posture.usersTruncated,
      securityDefaults: posture.securityDefaults.ok ? posture.securityDefaults.data : null,
      enforcing: ca?.name ?? null,
      consents: posture.consents.ok ? posture.consents.data : null,
      admins,
      devices: posture.devices?.ok ? posture.devices.data.slice(0, 2000) : null,
      unread: [...new Set(unread)],
      settings,
    },
  };
  await saveScan(db, integ.id, scan);
  return scan;
}
