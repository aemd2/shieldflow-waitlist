"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite, type Company } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import { subprocessorSchema, TRUST_REQUEST_STATUSES } from "@/lib/validation";

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

function row(d: z.infer<typeof subprocessorSchema>) {
  return {
    name: d.name,
    purpose: d.purpose || null,
    location: d.location || null,
    url: d.url || null,
  };
}

export async function createSubprocessor(input: unknown) {
  const parsed = subprocessorSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid data." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("subprocessors")
    .insert({ company_id: res.company.id, ...row(parsed.data) });
  if (error) return { error: "Could not add the subprocessor. Please try again." };

  await logEvent(res.supabase, res.company.id, "subprocessor.created", { type: "subprocessor", label: parsed.data.name });
  revalidatePath("/settings");
  return { ok: true };
}

export async function updateSubprocessor(id: string, input: unknown) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid subprocessor." };
  const parsed = subprocessorSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid data." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("subprocessors")
    .update(row(parsed.data))
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not save. Please try again." };

  revalidatePath("/settings");
  return { ok: true };
}

export async function deleteSubprocessor(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid subprocessor." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("subprocessors")
    .delete()
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not delete." };

  revalidatePath("/settings");
  return { ok: true };
}

export async function updateTrustRequestStatus(id: string, status: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid request." };
  if (!(TRUST_REQUEST_STATUSES as readonly string[]).includes(status)) {
    return { error: "Invalid status." };
  }

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("trust_access_requests")
    .update({ status })
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not update. Please try again." };

  revalidatePath("/settings");
  return { ok: true };
}

export async function deleteTrustRequest(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid request." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("trust_access_requests")
    .delete()
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not delete." };

  revalidatePath("/settings");
  return { ok: true };
}
