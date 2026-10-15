import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { CloudflareError } from "@/lib/cloudflare";
import { collectCloudflare, type CfAccount, type CfZone } from "@/lib/integrations/cloudflare/collect";
import { evaluateCloudflare } from "@/lib/integrations/cloudflare/evaluate";
import { loadExceptions, saveScan, type ProviderRoster, type ProviderScan } from "@/lib/integrations/scan-store";
import { toIdentityAccount } from "@/lib/integrations/people-match";

export interface CloudflareExtra {
  zones: CfZone[];
  zonesTruncated: boolean;
  accounts: (Omit<CfAccount, "members"> & { members: { email: string; name: string | null; twoFactor: boolean | null; roles: string[] }[] | null })[];
  unread: string[];
}

export interface TokenIntegrationRow {
  id: string;
  company_id: string;
  access_token: string | null;
  metadata: Record<string, unknown> | null;
}

export async function scanCloudflare(db: SupabaseClient, integ: TokenIntegrationRow): Promise<ProviderScan<CloudflareExtra>> {
  let token: string;
  try {
    token = decryptSecret(integ.access_token ?? "");
  } catch {
    throw new CloudflareError("auth", "Stored credentials are unreadable — please reconnect Cloudflare.");
  }
  const [posture, exceptions] = await Promise.all([collectCloudflare(token), loadExceptions(db, integ.company_id, "cloudflare")]);
  const results = evaluateCloudflare(posture, { now: new Date(), exceptions });

  const accounts = posture.accounts.ok ? posture.accounts.data : [];
  const unreadMembers = accounts.filter((a) => !a.members.ok).map((a) => a.name);
  const members = accounts.flatMap((a) => (a.members.ok ? a.members.data : []));
  const roster: ProviderRoster | null = posture.accounts.ok
    ? {
        all: members.map((m) => toIdentityAccount(m.email, m.status !== "rejected", [m.email])),
        humans: members.filter((m) => m.status !== "rejected").map((m) => toIdentityAccount(m.email, true, [m.email])),
        truncated: false,
        blindSpot: unreadMembers.length ? `the members of ${unreadMembers.join(", ")} couldn't be read` : null,
      }
    : null;
  const unread = [posture.zones, posture.accounts, ...accounts.map((a) => a.members)].filter((s) => !s.ok).map((s) => (s as { message: string }).message);

  const scan: ProviderScan<CloudflareExtra> = {
    provider: "cloudflare",
    scannedAt: posture.scannedAt,
    durationMs: posture.durationMs,
    results,
    roster,
    extra: {
      zones: posture.zones.ok ? posture.zones.data : [],
      zonesTruncated: posture.zonesTruncated,
      accounts: accounts.map((a) => ({ id: a.id, name: a.name, enforceTwoFactor: a.enforceTwoFactor, members: a.members.ok ? a.members.data.map((m) => ({ email: m.email, name: m.name, twoFactor: m.twoFactor, roles: m.roles })) : null })),
      unread: [...new Set(unread)],
    },
  };
  await saveScan(db, integ.id, scan);
  return scan;
}
