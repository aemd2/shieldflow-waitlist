// Measure-layer logic shared by the server actions and the sync/cron paths.
//
// Kept out of app/actions/measures.ts on purpose: the cron runs with the
// service-role admin client and cannot call a server action, but it needs the
// exact same propagation rules. One implementation, two callers.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ControlStatus } from "@/lib/score";

const RANK: Record<ControlStatus, number> = {
  not_started: 0,
  in_progress: 1,
  complete: 2,
};

/**
 * Push measure progress down onto the framework requirements it satisfies.
 *
 * ADVANCE-ONLY: a control can be moved forward by its measures but never dragged
 * back. Control status is still writable directly on the control page, and
 * silently undoing a judgement a human made there — because somebody reopened
 * one of several linked measures — would be worse than the staleness it leaves.
 *
 * Only MANDATORY measures gate completion. Several controls are also linked to
 * preferred measures (CC6.1 picks up "provide a password manager", CC8.1 picks
 * up "document your SDLC") and requiring those would mean a control could never
 * go green without doing optional work.
 *
 * Returns how many controls actually moved. Best-effort: never throws.
 */
export async function propagateMeasuresToControls(
  supabase: SupabaseClient,
  companyId: string,
  measureIds: string[],
  userId: string | null,
): Promise<number> {
  if (measureIds.length === 0) return 0;
  try {
    const { data: links } = await supabase
      .from("measure_controls")
      .select("control_id")
      .in("measure_id", measureIds);
    const controlIds = Array.from(
      new Set((links ?? []).map((l: any) => l.control_id as string)),
    );
    if (controlIds.length === 0) return 0;

    // Every measure feeding those controls — not just the ones that changed.
    const { data: siblings } = await supabase
      .from("measure_controls")
      .select("control_id, measure_id")
      .in("control_id", controlIds);
    const allMeasureIds = Array.from(
      new Set((siblings ?? []).map((s: any) => s.measure_id as string)),
    );

    const [{ data: statuses }, { data: lib }, { data: current }] = await Promise.all([
      supabase
        .from("measure_status")
        .select("measure_id, status")
        .eq("company_id", companyId)
        .in("measure_id", allMeasureIds),
      supabase.from("measures").select("id, importance").in("id", allMeasureIds),
      supabase
        .from("control_status")
        .select("control_id, status")
        .eq("company_id", companyId)
        .in("control_id", controlIds),
    ]);

    const statusOf = new Map<string, ControlStatus>(
      (statuses ?? []).map((s: any) => [s.measure_id as string, s.status as ControlStatus]),
    );
    const importanceOf = new Map<string, string>(
      (lib ?? []).map((m: any) => [m.id as string, m.importance as string]),
    );
    const currentOf = new Map<string, ControlStatus>(
      (current ?? []).map((c: any) => [c.control_id as string, c.status as ControlStatus]),
    );

    const byControl = new Map<string, string[]>();
    for (const s of siblings ?? []) {
      const cid = (s as any).control_id as string;
      const list = byControl.get(cid) ?? [];
      list.push((s as any).measure_id as string);
      byControl.set(cid, list);
    }

    let advanced = 0;
    for (const [controlId, ids] of byControl) {
      const mandatory = ids.filter((id) => importanceOf.get(id) === "mandatory");
      const gating = mandatory.length > 0 ? mandatory : ids;
      const anyStarted = ids.some((id) => (statusOf.get(id) ?? "not_started") !== "not_started");
      const derived: ControlStatus = gating.every((id) => statusOf.get(id) === "complete")
        ? "complete"
        : anyStarted
          ? "in_progress"
          : "not_started";

      const existing = currentOf.get(controlId);
      // No row means the company doesn't have this framework — skip entirely.
      if (existing === undefined) continue;
      if (RANK[derived] <= RANK[existing]) continue;

      const patch: Record<string, unknown> = {
        status: derived,
        updated_at: new Date().toISOString(),
      };
      if (userId) patch.updated_by = userId;

      const { error } = await supabase
        .from("control_status")
        .update(patch)
        .eq("company_id", companyId)
        .eq("control_id", controlId);
      if (!error) advanced += 1;
    }
    return advanced;
  } catch {
    return 0;
  }
}

export interface AutoCompleteResult {
  measuresCompleted: number;
  controlsAdvanced: number;
}

/**
 * Complete measures that the automated checks have already proven, then push
 * that down onto the controls those measures satisfy.
 *
 * This is the difference between "we gave you a list" and "we did the work":
 * connecting AWS proves root MFA is on, so the MFA measure should not sit
 * unticked waiting for a human to confirm what we just verified.
 *
 * The rule is deliberately conservative. A measure completes only when EVERY
 * mapped check the company actually has a result for is passing:
 *   - a workspace with only AWS completes `mfa` from aws.root_mfa
 *   - one that also runs Okta must pass okta.mfa as well
 *   - a check with no result never counts as passing, mirroring the checks
 *     engine itself where absent data is inconclusive and never green
 *
 * Advance-only, like everything else here: a failing check never *un*-completes
 * a measure someone marked by hand. The failure still surfaces on the dashboard
 * and the control page, where a human decides what it means.
 *
 * Best-effort — a failure here must never break the sync that triggered it.
 */
export async function autoCompleteMeasuresFromChecks(
  supabase: SupabaseClient,
  companyId: string,
  userId: string | null = null,
): Promise<AutoCompleteResult> {
  const none = { measuresCompleted: 0, controlsAdvanced: 0 };
  try {
    const [{ data: links }, { data: results }] = await Promise.all([
      supabase.from("measure_checks").select("measure_id, check_key"),
      supabase
        .from("control_checks")
        .select("check_key, result")
        .eq("company_id", companyId),
    ]);
    if (!links?.length || !results?.length) return none;

    // control_checks holds one row per (check x control), so the same check_key
    // repeats. Collapse to a single verdict per key; anything that isn't a clean
    // pass everywhere is treated as not passing.
    const verdict = new Map<string, boolean>();
    for (const r of results as any[]) {
      const key = r.check_key as string;
      const pass = r.result === "pass";
      verdict.set(key, verdict.has(key) ? Boolean(verdict.get(key)) && pass : pass);
    }

    const byMeasure = new Map<string, string[]>();
    for (const l of links as any[]) {
      const id = l.measure_id as string;
      const list = byMeasure.get(id) ?? [];
      list.push(l.check_key as string);
      byMeasure.set(id, list);
    }

    // Which of these does the company already have marked complete?
    const candidateIds = Array.from(byMeasure.keys());
    const { data: existing } = await supabase
      .from("measure_status")
      .select("measure_id, status")
      .eq("company_id", companyId)
      .in("measure_id", candidateIds);
    const existingOf = new Map<string, ControlStatus>(
      (existing ?? []).map((s: any) => [s.measure_id as string, s.status as ControlStatus]),
    );

    const toComplete: string[] = [];
    for (const [measureId, keys] of byMeasure) {
      if (existingOf.get(measureId) === "complete") continue;
      const present = keys.filter((k) => verdict.has(k));
      if (present.length === 0) continue;
      if (!present.every((k) => verdict.get(k))) continue;
      toComplete.push(measureId);
    }
    if (toComplete.length === 0) return none;

    const now = new Date().toISOString();
    const { error } = await supabase.from("measure_status").upsert(
      toComplete.map((measureId) => ({
        company_id: companyId,
        measure_id: measureId,
        status: "complete" as const,
        notes: "Completed automatically from a passing integration check.",
        updated_at: now,
        ...(userId ? { updated_by: userId } : {}),
      })),
      { onConflict: "company_id,measure_id" },
    );
    if (error) return none;

    const controlsAdvanced = await propagateMeasuresToControls(
      supabase,
      companyId,
      toComplete,
      userId,
    );
    return { measuresCompleted: toComplete.length, controlsAdvanced };
  } catch {
    return none;
  }
}
