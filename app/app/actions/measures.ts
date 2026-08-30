"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite, type Company } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import type { ControlStatus } from "@/lib/score";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

const measureStatusSchema = z.object({
  measureId: z.string().uuid("Invalid measure."),
  status: z.enum(["not_started", "in_progress", "complete"]),
  owner_email: z.string().email("Enter a valid email.").or(z.literal("")).optional(),
  notes: z.string().max(2000, "Notes are too long.").optional(),
});

async function companyOrError(): Promise<
  | { company: Company; supabase: Awaited<ReturnType<typeof createServerSupabase>>; userId: string }
  | { error: string }
> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  try {
    const company = await getCompanyForUser(supabase, user.id);
    if (!company) return { error: "No company found." };
    const denied = await assertCanWrite(supabase, company.id, user.id);
    if (denied) return { error: denied };
    return { company, supabase, userId: user.id };
  } catch {
    return { error: DB_ERROR };
  }
}

const RANK: Record<ControlStatus, number> = {
  not_started: 0,
  in_progress: 1,
  complete: 2,
};

/**
 * Push measure progress down onto the framework requirements it satisfies.
 *
 * Deliberately ADVANCE-ONLY: a control can be moved forward by its measures but
 * never dragged backwards. Control status is still writable directly on the
 * control page, and silently undoing a judgement a human made there — because
 * somebody reopened one of several linked measures — would be worse than the
 * staleness this leaves behind. Making control status purely derived is the
 * eventual destination (it is what Drata and Vanta do), but that is a change to
 * the control page's own UI, not something to smuggle in through a side effect.
 *
 * Derivation for a control: every MANDATORY linked measure complete -> complete;
 * any linked measure started -> in_progress. Only the mandatory ones gate
 * completion, because several controls are also linked to preferred measures
 * (CC6.1 picks up "provide a password manager", CC8.1 picks up "document your
 * SDLC") and requiring those would mean a control could never go green without
 * doing optional work. Preferred and advanced measures still move it to
 * in_progress and still show on the control. If a control happens to have no
 * mandatory measure at all, every linked measure gates it instead.
 *
 * Only ever written if it beats what is there.
 *
 * Best-effort: a failure here never fails the measure update the user asked for.
 */
async function propagateToControls(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  companyId: string,
  measureId: string,
  userId: string,
): Promise<number> {
  try {
    // Which controls does this measure touch?
    const { data: links } = await supabase
      .from("measure_controls")
      .select("control_id")
      .eq("measure_id", measureId);
    const controlIds = (links ?? []).map((l: any) => l.control_id as string);
    if (controlIds.length === 0) return 0;

    // All measures feeding those controls, and this company's progress on them.
    const { data: siblings } = await supabase
      .from("measure_controls")
      .select("control_id, measure_id")
      .in("control_id", controlIds);
    const allMeasureIds = Array.from(
      new Set((siblings ?? []).map((s: any) => s.measure_id as string)),
    );

    const [{ data: statuses }, { data: lib }] = await Promise.all([
      supabase
        .from("measure_status")
        .select("measure_id, status")
        .eq("company_id", companyId)
        .in("measure_id", allMeasureIds),
      supabase.from("measures").select("id, importance").in("id", allMeasureIds),
    ]);
    const statusOf = new Map<string, ControlStatus>(
      (statuses ?? []).map((s: any) => [s.measure_id as string, s.status as ControlStatus]),
    );
    const importanceOf = new Map<string, string>(
      (lib ?? []).map((m: any) => [m.id as string, m.importance as string]),
    );

    // Current control status, so we only ever move forward.
    const { data: current } = await supabase
      .from("control_status")
      .select("control_id, status")
      .eq("company_id", companyId)
      .in("control_id", controlIds);
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
    for (const [controlId, measureIds] of byControl) {
      const mandatory = measureIds.filter((id) => importanceOf.get(id) === "mandatory");
      const gating = mandatory.length > 0 ? mandatory : measureIds;
      const anyStarted = measureIds.some(
        (id) => (statusOf.get(id) ?? "not_started") !== "not_started",
      );
      const derived: ControlStatus = gating.every((id) => statusOf.get(id) === "complete")
        ? "complete"
        : anyStarted
          ? "in_progress"
          : "not_started";

      const existing = currentOf.get(controlId);
      // No row means the company doesn't have this framework — skip it entirely.
      if (existing === undefined) continue;
      if (RANK[derived] <= RANK[existing]) continue;

      const { error } = await supabase
        .from("control_status")
        .update({ status: derived, updated_at: new Date().toISOString(), updated_by: userId })
        .eq("company_id", companyId)
        .eq("control_id", controlId);
      if (!error) advanced += 1;
    }
    return advanced;
  } catch {
    return 0;
  }
}

export async function updateMeasureStatus(
  input: unknown,
): Promise<{ error?: string; advanced?: number }> {
  const parsed = measureStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const ctx = await companyOrError();
  if ("error" in ctx) return { error: ctx.error };
  const { company, supabase, userId } = ctx;
  const { measureId, status, owner_email, notes } = parsed.data;

  const { error } = await supabase.from("measure_status").upsert(
    {
      company_id: company.id,
      measure_id: measureId,
      status,
      owner_email: owner_email || null,
      notes: notes || null,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    },
    { onConflict: "company_id,measure_id" },
  );
  if (error) return { error: DB_ERROR };

  const advanced = await propagateToControls(supabase, company.id, measureId, userId);

  const { data: m } = await supabase
    .from("measures")
    .select("name")
    .eq("id", measureId)
    .maybeSingle();

  await logEvent(supabase, company.id, "measure.status_changed", {
    type: "measure",
    id: measureId,
    label: (m as any)?.name ?? "a measure",
    metadata: { status, controls_advanced: advanced },
  });

  revalidatePath("/measures");
  revalidatePath("/dashboard");
  return { advanced };
}
