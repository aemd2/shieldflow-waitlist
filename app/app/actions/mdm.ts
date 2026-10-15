"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { disconnectProvider } from "@/lib/integration-evidence";
import { csvRow, fileMeasureCsv } from "@/lib/evidence-population";
import { connectWithCredentials, scanWithCredentials } from "@/lib/integrations/token-actions";
import { normalizeJamfUrl, normalizeKandjiHost, readMdm, type MdmProvider } from "@/lib/integrations/mdm/clients";
import { scanMdm, type MdmExtra } from "@/lib/integrations/mdm/scan";
import { MDM_META } from "@/lib/integrations/mdm/catalog";
import type { ProviderScan } from "@/lib/integrations/scan-store";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";
const field = z.string().trim().min(3, "That looks too short.").max(2000);

async function connectMdm(provider: MdmProvider, creds: Record<string, string>) {
  return connectWithCredentials(provider, creds, async () => {
    const read = await readMdm(provider, creds);
    return { label: `${MDM_META[provider].title} · ${read.devices.length} devices`, metadata: { devices: read.devices.length } };
  });
}

function deviceCsv(provider: MdmProvider, scan: ProviderScan<MdmExtra>) {
  return [
    csvRow(`# Devices managed by ${MDM_META[provider].title} — ${new Date().toISOString().slice(0, 10)}`),
    csvRow("device", "os", "os_version", "encrypted", "last_check_in", "owner"),
    ...scan.extra.devices.map((d) => csvRow(d.name, d.os, d.osVersion, d.encrypted ?? "unknown", d.lastSeen ?? "never", d.owner)),
  ].join("\n");
}

function syncMdm(provider: MdmProvider) {
  return scanWithCredentials(
    provider,
    MDM_META[provider].checks,
    (db, integ) => scanMdm(db, provider, integ),
    (scan, company) => {
      const d = scan.extra.devices;
      const encrypted = d.filter((x) => x.encrypted).length;
      return {
        csv: [`# ${MDM_META[provider].title} device report`, `# Company: ${company}`, deviceCsv(provider, scan)].join("\n"),
        note: `Automated ${MDM_META[provider].title} scan: ${d.length} devices, ${encrypted} encrypted.`,
        summary: { devices: d.length, encrypted },
      };
    },
    async (db, companyId, userId, scan) => {
      const day = new Date().toISOString().slice(0, 10);
      await fileMeasureCsv(
        db,
        companyId,
        userId,
        "endpoint-protection",
        `${provider}-devices-${day}.csv`,
        deviceCsv(provider, scan),
        `Generated from ${MDM_META[provider].title} by ShieldFlow: every managed device, its disk encryption and last check-in.`,
      );
    },
  );
}

// -------------------------------------------------------------------- Kandji
export async function connectKandji(input: { apiUrl: string; token: string }) {
  const p = z.object({ apiUrl: z.string().trim().min(1).max(300), token: field }).safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input." };
  const host = normalizeKandjiHost(p.data.apiUrl);
  if (!host) return { error: "Paste the API URL from Kandji → Settings → Access, e.g. https://yourco.api.kandji.io." };
  return connectMdm("kandji", { host, token: p.data.token });
}
export async function syncKandji() {
  return syncMdm("kandji");
}
export async function disconnectKandji() {
  return disconnectProvider("kandji");
}

// ---------------------------------------------------------------------- Jamf
export async function connectJamf(input: { url: string; clientId: string; clientSecret: string }) {
  const p = z.object({ url: z.string().trim().min(1).max(300), clientId: field, clientSecret: field }).safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input." };
  const url = normalizeJamfUrl(p.data.url);
  if (!url) return { error: "Enter your Jamf Pro address over https, e.g. https://yourco.jamfcloud.com." };
  return connectMdm("jamf", { url, clientId: p.data.clientId, clientSecret: p.data.clientSecret });
}
export async function syncJamf() {
  return syncMdm("jamf");
}
export async function disconnectJamf() {
  return disconnectProvider("jamf");
}

// ------------------------------------------------------------------ settings
const settingsSchema = z.object({ staleDays: z.number().int().min(3).max(90) }).partial();

async function updateMdmSettings(provider: MdmProvider, input: unknown) {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: "The check-in window must be 3–90 days." };
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const company = await getCompanyForUser(supabase, user.id).catch(() => null);
  if (!company) return { error: "No company found." };
  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { error: denied };
  const { data: integ } = await supabase.from("integrations").select("id, metadata").eq("company_id", company.id).eq("provider", provider).maybeSingle();
  if (!integ) return { error: "Not connected yet." };
  const meta = (integ.metadata as Record<string, unknown> | null) ?? {};
  const current = (meta.settings as Record<string, unknown> | undefined) ?? {};
  const { error } = await supabase.from("integrations").update({ metadata: { ...meta, settings: { ...current, ...parsed.data } } }).eq("id", integ.id);
  if (error) return { error: DB_ERROR };
  revalidatePath(`/integrations/${provider}`);
  return { ok: true };
}
export async function updateKandjiSettings(input: unknown) {
  return updateMdmSettings("kandji", input);
}
export async function updateJamfSettings(input: unknown) {
  return updateMdmSettings("jamf", input);
}

