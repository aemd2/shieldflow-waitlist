"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { decryptSecret } from "@/lib/crypto";
import { logEvent } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { isProviderScan } from "@/lib/integrations/scan-store";
import { PROVIDER_BY_KEY } from "@/lib/integrations/registry";
import { jiraCreate, linearCreate, type JiraCreds, type Tracker } from "@/lib/integrations/tickets/clients";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

async function session() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const company = await getCompanyForUser(supabase, user.id).catch(() => null);
  if (!company) return { error: "No company found." } as const;
  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { error: denied } as const;
  return { supabase, company } as const;
}

const ticketingSchema = z.object({
  tracker: z.enum(["jira", "linear"]),
  enabled: z.boolean(),
  /** Jira project key or Linear team key. */
  target: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{0,19}$/, "Pick a project / team.").optional(),
});

/**
 * Turn "Create a ticket" on or off. Off by default: creating issues is the one
 * thing ShieldFlow writes anywhere, so a person has to switch it on and choose
 * where they go.
 */
export async function updateTicketing(input: unknown) {
  const parsed = ticketingSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid settings." };
  if (parsed.data.enabled && !parsed.data.target) return { error: "Pick where tickets should go." };
  const s = await session();
  if ("error" in s) return { error: s.error };
  const { data: integ } = await s.supabase.from("integrations").select("id, metadata").eq("company_id", s.company.id).eq("provider", parsed.data.tracker).maybeSingle();
  if (!integ) return { error: "Not connected yet." };
  const meta = (integ.metadata as Record<string, unknown> | null) ?? {};
  const { error } = await s.supabase
    .from("integrations")
    .update({ metadata: { ...meta, ticketing: { enabled: parsed.data.enabled, target: parsed.data.target ?? null } } })
    .eq("id", integ.id);
  if (error) return { error: DB_ERROR };
  await logEvent(s.supabase, s.company.id, parsed.data.enabled ? "ticketing.enabled" : "ticketing.disabled", { type: "integration", label: `${parsed.data.tracker}${parsed.data.target ? ` → ${parsed.data.target}` : ""}` });
  revalidatePath(`/integrations/${parsed.data.tracker}`);
  revalidatePath("/integrations", "layout");
  return { ok: true };
}

const createSchema = z.object({ page: z.string().min(2).max(40), checkKey: z.string().min(3).max(120) });

/** Create a ticket for a failing check, from the check's own last result (never from what the browser sends). */
export async function createTicketForCheck(input: unknown) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: "Unknown check." };
  const entry = PROVIDER_BY_KEY.get(parsed.data.page);
  const def = entry?.checks.find((c) => c.key === parsed.data.checkKey);
  if (!entry || !def) return { error: "Unknown check." };
  const s = await session();
  if ("error" in s) return { error: s.error };
  if (!checkRateLimit(`ticket:${s.company.id}`, 10, 60_000)) return { error: "Slow down — try again in a minute." };

  const { data: rows } = await s.supabase.from("integrations").select("id, provider, access_token, metadata, last_scan, status").eq("company_id", s.company.id).in("provider", ["jira", "linear", entry.key]);
  const tracker = (rows ?? []).find((r) => (r.provider === "jira" || r.provider === "linear") && r.status === "connected" && (r.metadata as { ticketing?: { enabled?: boolean } } | null)?.ticketing?.enabled);
  if (!tracker?.access_token) return { error: "Ticket creation is off — turn it on on the Jira or Linear page." };
  const meta = (tracker.metadata as { ticketing: { target: string }; tickets?: Record<string, string> }) ?? {};
  if (meta.tickets?.[def.key]) return { error: `There's already a ticket for this: ${meta.tickets[def.key]}.` };

  const page = (rows ?? []).find((r) => r.provider === entry.key);
  const scan = isProviderScan(page?.last_scan) ? page!.last_scan : null;
  const result = scan?.results.find((r) => r.key === def.key);
  if (!result || result.result !== "fail") return { error: "This check isn't failing in the last scan." };

  const title = `[ShieldFlow] ${entry.title}: ${def.title}`;
  const body = [
    result.detail,
    result.resources.length ? `Affected:\n${result.resources.slice(0, 25).map((r) => `• ${r.label}`).join("\n")}${result.failingCount > 25 ? `\n…and ${result.failingCount - 25} more` : ""}` : "",
    `Why it matters: ${def.why}`,
    `How to fix: ${def.fix.console}`,
    `Opened from ShieldFlow — it closes the loop by itself: the next scan after the fix turns this check green.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const name = tracker.provider === "jira" ? "Jira" : "Linear";
  let secret: string;
  let jiraCreds: JiraCreds | null = null;
  try {
    secret = decryptSecret(tracker.access_token as string);
    if (tracker.provider === "jira") jiraCreds = JSON.parse(secret) as JiraCreds;
  } catch {
    return { error: `The stored ${name} credentials are unreadable — reconnect ${name}.` };
  }
  let created;
  try {
    created = jiraCreds ? await jiraCreate(jiraCreds, meta.ticketing.target, title, body) : await linearCreate(secret, meta.ticketing.target, title, body);
  } catch (err) {
    return { error: (err as { userMessage?: string }).userMessage ?? `${name} didn't create the ticket — try again.` };
  }
  await s.supabase
    .from("integrations")
    .update({ metadata: { ...meta, tickets: { ...(meta.tickets ?? {}), [def.key]: created.key } } })
    .eq("id", tracker.id);
  await logEvent(s.supabase, s.company.id, "ticket.created", { type: "check", id: def.key, label: `${created.key} — ${def.title}`, metadata: { tracker: tracker.provider as Tracker } });
  revalidatePath(`/integrations/${entry.key}`);
  return { ok: true, key: created.key, url: created.url };
}
