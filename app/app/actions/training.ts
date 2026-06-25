"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite, type Company } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import { trainingSchema } from "@/lib/validation";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

async function companyOrError(): Promise<
  { company: Company; supabase: Awaited<ReturnType<typeof createServerSupabase>> } | { error: string }
> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  try {
    const company = await getCompanyForUser(supabase, user.id);
    if (!company) return { error: "No company found." };
    const denied = await assertCanWrite(supabase, company.id, user.id);
    if (denied) return { error: denied };
    return { company, supabase };
  } catch {
    return { error: DB_ERROR };
  }
}

const today = () => new Date().toISOString().slice(0, 10);

function toRow(d: z.infer<typeof trainingSchema>) {
  return {
    person_name: d.person_name,
    person_email: d.person_email || null,
    course: d.course,
    status: d.status,
    due_date: d.due_date || null,
    // Stamp completion automatically when marked completed.
    completed_date: d.status === "completed" ? today() : null,
  };
}

export async function createTraining(input: unknown) {
  const parsed = trainingSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid training data." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase.from("training_records").insert({
    company_id: res.company.id,
    assigned_date: today(),
    ...toRow(parsed.data),
  });
  if (error) return { error: "Could not add the training record. Please try again." };

  await logEvent(res.supabase, res.company.id, "training.created", {
    type: "training",
    label: parsed.data.course,
    metadata: { person: parsed.data.person_name, status: parsed.data.status },
  });

  revalidatePath("/training");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function updateTraining(id: string, input: unknown) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid record." };
  const parsed = trainingSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid training data." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("training_records")
    .update(toRow(parsed.data))
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not save the record. Please try again." };

  await logEvent(res.supabase, res.company.id, "training.updated", {
    type: "training",
    id,
    label: parsed.data.course,
    metadata: { status: parsed.data.status },
  });

  revalidatePath("/training");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteTraining(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid record." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { data: existing } = await res.supabase
    .from("training_records")
    .select("course")
    .eq("company_id", res.company.id)
    .eq("id", id)
    .maybeSingle();

  const { error } = await res.supabase
    .from("training_records")
    .delete()
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not delete the record." };

  await logEvent(res.supabase, res.company.id, "training.deleted", {
    type: "training",
    id,
    label: (existing?.course as string | undefined) ?? undefined,
  });

  revalidatePath("/training");
  revalidatePath("/dashboard");
  return { ok: true };
}
