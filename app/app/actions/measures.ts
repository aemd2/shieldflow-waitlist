"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite, type Company } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import { propagateMeasuresToControls } from "@/lib/measures";

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

  const advanced = await propagateMeasuresToControls(supabase, company.id, [measureId], userId);

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
