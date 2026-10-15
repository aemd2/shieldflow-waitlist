import type { SupabaseClient } from "@supabase/supabase-js";
import { hrState, type HrEmployee, type HrisProvider } from "@/lib/integrations/hris/clients";

/**
 * Keep Personnel in step with the HR system, so every leaver check in Google,
 * Microsoft, Okta, AWS and GitHub runs off HR's leaving dates, not a list
 * someone has to remember to update.
 *
 * Rules, in order:
 *  - a person is matched by the HR id it was synced from, else by work email
 *    (an existing hand-made row is adopted, not duplicated);
 *  - HR wins on name, email, title, start date, leaving date and status;
 *  - someone in their notice period stays active with their leaving date set;
 *  - leavers more than a year gone who were never in Personnel aren't imported;
 *  - nobody is ever deleted — contractors and anyone added by hand stay.
 */

export interface PersonnelRow {
  id: string;
  name: string;
  email: string | null;
  role_title: string | null;
  status: "active" | "offboarded";
  started_at: string | null;
  ended_at: string | null;
  source: string | null;
  external_id: string | null;
}

export interface SyncPlan {
  inserts: Omit<PersonnelRow, "id">[];
  updates: { id: string; patch: Partial<PersonnelRow>; name: string; offboarded: boolean }[];
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Pure: what to change in Personnel. */
export function planPersonnelSync(source: HrisProvider, employees: HrEmployee[], existing: PersonnelRow[], today: string): SyncPlan {
  const bySource = new Map(existing.filter((p) => p.source === source && p.external_id).map((p) => [p.external_id!, p]));
  const byEmail = new Map(existing.filter((p) => p.email).map((p) => [norm(p.email), p]));
  const yearAgo = new Date(Date.parse(today) - 365 * 86_400_000).toISOString().slice(0, 10);
  const claimed = new Set<string>();
  const plan: SyncPlan = { inserts: [], updates: [] };

  for (const e of employees) {
    const state = hrState(e, today);
    const want = {
      name: e.name,
      email: e.email,
      role_title: e.title,
      status: (state === "left" ? "offboarded" : "active") as PersonnelRow["status"],
      started_at: e.startDate,
      ended_at: e.endDate,
      source,
      external_id: e.externalId,
    };
    let match = bySource.get(e.externalId) ?? (e.email ? byEmail.get(norm(e.email)) : undefined);
    if (match && claimed.has(match.id)) match = undefined; // two HR records, one person: keep the first
    if (match) {
      claimed.add(match.id);
      const patch: Partial<PersonnelRow> = {};
      for (const k of Object.keys(want) as (keyof typeof want)[]) {
        const v = want[k];
        // Never blank a value HR doesn't have (a missing email or title stays as it was).
        if (v === null && match[k] !== null && (k === "email" || k === "role_title" || k === "started_at")) continue;
        if ((match[k] ?? null) !== (v ?? null)) (patch as Record<string, unknown>)[k] = v;
      }
      if (Object.keys(patch).length) plan.updates.push({ id: match.id, patch, name: e.name, offboarded: patch.status === "offboarded" });
    } else {
      if (state === "left" && (!e.endDate || e.endDate < yearAgo)) continue;
      plan.inserts.push(want);
    }
  }
  return plan;
}

export interface SyncResult {
  added: number;
  updated: number;
  offboarded: string[];
  errors: number;
}

export async function syncPersonnel(db: SupabaseClient, companyId: string, source: HrisProvider, employees: HrEmployee[]): Promise<SyncResult> {
  const { data } = await db
    .from("personnel")
    .select("id, name, email, role_title, status, started_at, ended_at, source, external_id")
    .eq("company_id", companyId);
  const today = new Date().toISOString().slice(0, 10);
  const plan = planPersonnelSync(source, employees, (data ?? []) as PersonnelRow[], today);
  const result: SyncResult = { added: 0, updated: 0, offboarded: [], errors: 0 };

  for (let i = 0; i < plan.inserts.length; i += 200) {
    const batch = plan.inserts.slice(i, i + 200).map((r) => ({ company_id: companyId, ...r }));
    const { error } = await db.from("personnel").insert(batch);
    if (error) result.errors += batch.length;
    else result.added += batch.length;
  }
  for (const u of plan.updates) {
    const { error } = await db.from("personnel").update(u.patch).eq("id", u.id).eq("company_id", companyId);
    if (error) result.errors++;
    else {
      result.updated++;
      if (u.offboarded) result.offboarded.push(u.name);
    }
  }
  return result;
}
