import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { ok, type Section } from "@/lib/checks-core";
import { evaluateDevices, type Device } from "@/lib/integrations/devices";
import { MdmError, readMdm, type MdmProvider } from "@/lib/integrations/mdm/clients";
import { loadExceptions, saveScan, settingsOf, type ProviderScan } from "@/lib/integrations/scan-store";

export const MDM_DEFAULTS = { staleDays: 14 };

export interface MdmExtra {
  devices: Device[];
  truncated: boolean;
  detailsSkipped: number;
  settings: typeof MDM_DEFAULTS;
}

export interface MdmIntegrationRow {
  id: string;
  company_id: string;
  access_token: string | null;
  metadata: Record<string, unknown> | null;
}

export async function scanMdm(db: SupabaseClient, provider: MdmProvider, integ: MdmIntegrationRow): Promise<ProviderScan<MdmExtra>> {
  let creds: unknown;
  try {
    creds = JSON.parse(decryptSecret(integ.access_token ?? ""));
  } catch {
    throw new MdmError("auth", "Stored credentials are unreadable — please reconnect.");
  }
  const started = Date.now();
  const settings = settingsOf(integ.metadata, MDM_DEFAULTS);
  const [read, exceptions, { data: people }] = await Promise.all([
    readMdm(provider, creds),
    loadExceptions(db, integ.company_id, provider),
    db.from("personnel").select("name, email, status").eq("company_id", integ.company_id),
  ]);
  const staff = ((people ?? []) as { name: string; email: string | null; status: string }[]).filter((p) => p.email).map((p) => ({ name: p.name, email: p.email!, status: p.status }));
  const devices: Section<Device[]> = ok(read.devices);
  const results = evaluateDevices(provider, devices, { now: new Date(), exceptions, staleDays: settings.staleDays, people: staff }, read.truncated);

  const scan: ProviderScan<MdmExtra> = {
    provider,
    scannedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    results,
    // Leavers with a laptop are the device_leavers check; a laptop isn't an account.
    roster: null,
    extra: { devices: read.devices.slice(0, 2000), truncated: read.truncated, detailsSkipped: read.detailsSkipped, settings },
  };
  await saveScan(db, integ.id, scan);
  return scan;
}
