import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { GcpError } from "@/lib/gcp";
import { collectGcp, type GcpBucket, type GcpFirewall, type GcpKey, type GcpSql } from "@/lib/integrations/gcp/collect";
import { evaluateGcp } from "@/lib/integrations/gcp/evaluate";
import { loadExceptions, saveScan, settingsOf, type ProviderScan } from "@/lib/integrations/scan-store";

export const GCP_DEFAULTS = { keyMaxDays: 90 };

export interface GcpExtra {
  serviceAccount: string;
  projects: { id: string; owners: string[]; keys: GcpKey[] | null; buckets: GcpBucket[] | null; firewalls: GcpFirewall[] | null; sql: GcpSql[] | null }[];
  projectsTruncated: boolean;
  unread: string[];
  settings: typeof GCP_DEFAULTS;
}

export async function scanGcp(db: SupabaseClient, integ: { id: string; company_id: string; access_token: string | null; metadata: Record<string, unknown> | null }): Promise<ProviderScan<GcpExtra>> {
  let keyJson: string;
  try {
    keyJson = decryptSecret(integ.access_token ?? "");
  } catch {
    throw new GcpError("auth", "Stored credentials are unreadable — please reconnect Google Cloud.");
  }
  const settings = settingsOf(integ.metadata, GCP_DEFAULTS);
  const [posture, exceptions] = await Promise.all([collectGcp(keyJson), loadExceptions(db, integ.company_id, "gcp")]);
  const results = evaluateGcp(posture, { now: new Date(), exceptions, keyMaxDays: settings.keyMaxDays });
  const val = <T,>(s: { ok: true; data: T } | { ok: false }) => (s.ok ? s.data : null);
  const unread = posture.projects.flatMap((p) => [p.iam, p.keys, p.buckets, p.firewalls, p.sql]).filter((s) => !s.ok).map((s) => (s as { message: string }).message);

  const scan: ProviderScan<GcpExtra> = {
    provider: "gcp",
    scannedAt: posture.scannedAt,
    durationMs: posture.durationMs,
    results,
    roster: null,
    extra: {
      serviceAccount: posture.serviceAccount,
      projects: posture.projects.map((p) => ({
        id: p.id,
        owners: p.iam.ok ? [...new Set(p.iam.data.filter((b) => b.role === "roles/owner").flatMap((b) => b.members))] : [],
        keys: val(p.keys),
        buckets: val(p.buckets),
        firewalls: val(p.firewalls),
        sql: val(p.sql),
      })),
      projectsTruncated: posture.projectsTruncated,
      unread: [...new Set(unread)],
      settings,
    },
  };
  await saveScan(db, integ.id, scan);
  return scan;
}
