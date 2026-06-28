"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite, type Company } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import { personnelSchema } from "@/lib/validation";

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

function row(d: z.infer<typeof personnelSchema>) {
  return {
    name: d.name,
    email: d.email || null,
    role_title: d.role_title || null,
    started_at: d.started_at || null,
  };
}

export async function createPerson(input: unknown) {
  const parsed = personnelSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid person data." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("personnel")
    .insert({ company_id: res.company.id, ...row(parsed.data) });
  if (error) return { error: "Could not add the person. Please try again." };

  await logEvent(res.supabase, res.company.id, "personnel.created", { type: "personnel", label: parsed.data.name });
  revalidatePath("/personnel");
  return { ok: true };
}

export async function updatePerson(id: string, input: unknown) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid person." };
  const parsed = personnelSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid person data." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("personnel")
    .update(row(parsed.data))
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not save. Please try again." };

  revalidatePath("/personnel");
  return { ok: true };
}

/** Offboard: mark inactive and stamp the end date (the audit-relevant event). */
export async function offboardPerson(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid person." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { data: existing } = await res.supabase
    .from("personnel")
    .select("name")
    .eq("company_id", res.company.id)
    .eq("id", id)
    .maybeSingle();

  const { error } = await res.supabase
    .from("personnel")
    .update({ status: "offboarded", ended_at: new Date().toISOString().slice(0, 10) })
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not offboard. Please try again." };

  await logEvent(res.supabase, res.company.id, "personnel.offboarded", {
    type: "personnel",
    id,
    label: (existing?.name as string | undefined) ?? undefined,
  });
  revalidatePath("/personnel");
  return { ok: true };
}

export async function reactivatePerson(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid person." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("personnel")
    .update({ status: "active", ended_at: null })
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not reactivate. Please try again." };

  revalidatePath("/personnel");
  return { ok: true };
}

export async function deletePerson(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid person." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { data: existing } = await res.supabase
    .from("personnel")
    .select("name")
    .eq("company_id", res.company.id)
    .eq("id", id)
    .maybeSingle();

  const { error } = await res.supabase
    .from("personnel")
    .delete()
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not delete." };

  await logEvent(res.supabase, res.company.id, "personnel.deleted", {
    type: "personnel",
    id,
    label: (existing?.name as string | undefined) ?? undefined,
  });
  revalidatePath("/personnel");
  return { ok: true };
}
