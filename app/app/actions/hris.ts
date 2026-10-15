"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { disconnectProvider } from "@/lib/integration-evidence";
import { csvSafe } from "@/lib/csv";
import { csvRow, fileMeasureCsv } from "@/lib/evidence-population";
import { connectWithCredentials, scanWithCredentials } from "@/lib/integrations/token-actions";
import { normalizeBambooSubdomain, readHris, type HrisProvider } from "@/lib/integrations/hris/clients";
import { scanHris, type HrisExtra } from "@/lib/integrations/hris/scan";
import { HRIS_META } from "@/lib/integrations/hris/catalog";
import type { ProviderScan } from "@/lib/integrations/scan-store";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";
const field = z.string().trim().min(3, "That looks too short.").max(500);

async function connectHris(provider: HrisProvider, creds: Record<string, string>) {
  return connectWithCredentials(provider, creds, async () => {
    const read = await readHris(provider, creds);
    const current = read.employees.filter((e) => e.active).length;
    return { label: `${HRIS_META[provider].title} · ${current} current employees`, metadata: { employees: current } };
  });
}

function report(provider: HrisProvider) {
  return (scan: ProviderScan<HrisExtra>, company: string) => {
    const x = scan.extra;
    const csv = [
      `# ${HRIS_META[provider].title} employee report`,
      `# Generated: ${new Date().toISOString()}`,
      `# Company: ${company}`,
      `# Personnel sync: ${x.sync.added} added, ${x.sync.updated} updated${x.sync.offboarded.length ? `, offboarded: ${x.sync.offboarded.join("; ")}` : ""}`,
      ...(x.missingFields.length ? [`# Not readable with these credentials: ${x.missingFields.join("; ")}`] : []),
      ``,
      `name,work_email,title,start_date,leaving_date,state,security_training_done`,
      ...x.employees.map((e) => [csvSafe(e.name), csvSafe(e.email ?? ""), csvSafe(e.title ?? ""), e.startDate ?? "", e.endDate ?? "", e.state, e.trained === null ? "unknown" : e.trained ? "yes" : "no"].join(",")),
    ].join("\n");
    const current = x.employees.filter((e) => e.state !== "left").length;
    return {
      csv,
      note: `Automated ${HRIS_META[provider].title} sync: ${current} current employees; Personnel ${x.sync.added} added, ${x.sync.updated} updated.`,
      summary: { employees: current, added: x.sync.added, updated: x.sync.updated },
    };
  };
}

/** The CC6.2/CC6.3 sample: everyone who left in the last 12 months, with their leaving date. */
function fileTerminations(provider: HrisProvider) {
  return async (db: Awaited<ReturnType<typeof createServerSupabase>>, companyId: string, userId: string, scan: ProviderScan<HrisExtra>) => {
    const day = new Date().toISOString().slice(0, 10);
    const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const leavers = scan.extra.employees.filter((e) => e.endDate && e.endDate >= yearAgo && e.endDate <= day);
    if (!leavers.length) return;
    await fileMeasureCsv(
      db,
      companyId,
      userId,
      "offboarding-checklist",
      `${provider}-leavers-${day}.csv`,
      [csvRow(`# Leavers in the last 12 months, from ${HRIS_META[provider].title} — ${day}`), csvRow("name", "work_email", "title", "leaving_date"), ...leavers.map((e) => csvRow(e.name, e.email, e.title, e.endDate))].join("\n"),
      `Generated from ${HRIS_META[provider].title} by ShieldFlow: every leaver in the last 12 months with their leaving date — the population an auditor samples to check access was removed in time.`,
    );
  };
}

async function syncHris(provider: HrisProvider) {
  return scanWithCredentials(provider, HRIS_META[provider].checks, (db, integ) => scanHris(db, provider, integ), report(provider), fileTerminations(provider));
}

// ------------------------------------------------------------------ Personio
export async function connectPersonio(input: { clientId: string; clientSecret: string }) {
  const p = z.object({ clientId: field, clientSecret: field }).safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input." };
  return connectHris("personio", p.data);
}
export async function syncPersonio() {
  return syncHris("personio");
}
export async function disconnectPersonio() {
  return disconnectProvider("personio");
}

// --------------------------------------------------------------------- HiBob
export async function connectHiBob(input: { serviceUserId: string; token: string }) {
  const p = z.object({ serviceUserId: field, token: field }).safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input." };
  return connectHris("hibob", p.data);
}
export async function syncHiBob() {
  return syncHris("hibob");
}
export async function disconnectHiBob() {
  return disconnectProvider("hibob");
}

// ------------------------------------------------------------------ BambooHR
export async function connectBambooHR(input: { subdomain: string; apiKey: string }) {
  const p = z.object({ subdomain: z.string().trim().min(1).max(200), apiKey: field }).safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input." };
  const subdomain = normalizeBambooSubdomain(p.data.subdomain);
  if (!subdomain) return { error: "Enter your BambooHR subdomain — the part before .bamboohr.com." };
  return connectHris("bamboohr", { subdomain, apiKey: p.data.apiKey });
}
export async function syncBambooHR() {
  return syncHris("bamboohr");
}
export async function disconnectBambooHR() {
  return disconnectProvider("bamboohr");
}

// ------------------------------------------------------------------ settings
const settingsSchema = z.object({ trainingDays: z.number().int().min(7).max(120) }).partial();

async function updateHrisSettings(provider: HrisProvider, input: unknown) {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: "Training must be due 7–120 days after starting." };
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
export async function updatePersonioSettings(input: unknown) {
  return updateHrisSettings("personio", input);
}
export async function updateHiBobSettings(input: unknown) {
  return updateHrisSettings("hibob", input);
}
export async function updateBambooHRSettings(input: unknown) {
  return updateHrisSettings("bamboohr", input);
}
