"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite, type Company } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import { questionnaireCreateSchema, questionnaireItemSchema } from "@/lib/validation";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

async function companyOrError(): Promise<
  | { company: Company; supabase: Awaited<ReturnType<typeof createServerSupabase>>; userId: string }
  | { error: string }
> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
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

export async function createQuestionnaire(input: unknown) {
  const parsed = questionnaireCreateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid questionnaire." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { data: q, error } = await res.supabase
    .from("questionnaires")
    .insert({ company_id: res.company.id, name: parsed.data.name, created_by: res.userId })
    .select("id")
    .single();
  if (error || !q) return { error: "Could not create the questionnaire. Please try again." };

  const items = parsed.data.questions.map((question, idx) => ({
    questionnaire_id: q.id as string,
    company_id: res.company.id,
    position: idx,
    question,
  }));
  const { error: itemsErr } = await res.supabase.from("questionnaire_items").insert(items);
  if (itemsErr) {
    await res.supabase.from("questionnaires").delete().eq("id", q.id); // compensate
    return { error: "Could not save the questions. Please try again." };
  }

  await logEvent(res.supabase, res.company.id, "questionnaire.created", {
    type: "questionnaire",
    id: q.id as string,
    label: parsed.data.name,
    metadata: { questions: parsed.data.questions.length },
  });

  revalidatePath("/questionnaires");
  return { ok: true, id: q.id as string };
}

export async function saveQuestionnaireItem(input: unknown) {
  const parsed = questionnaireItemSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("questionnaire_items")
    .update({ answer: parsed.data.answer || null, status: parsed.data.status })
    .eq("company_id", res.company.id)
    .eq("id", parsed.data.id);
  if (error) return { error: "Could not save. Please try again." };

  revalidatePath("/questionnaires");
  return { ok: true };
}

export async function deleteQuestionnaire(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid questionnaire." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { data: existing } = await res.supabase
    .from("questionnaires")
    .select("name")
    .eq("company_id", res.company.id)
    .eq("id", id)
    .maybeSingle();

  const { error } = await res.supabase
    .from("questionnaires")
    .delete()
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not delete the questionnaire." };

  await logEvent(res.supabase, res.company.id, "questionnaire.deleted", {
    type: "questionnaire",
    id,
    label: (existing?.name as string | undefined) ?? undefined,
  });

  revalidatePath("/questionnaires");
  return { ok: true };
}
