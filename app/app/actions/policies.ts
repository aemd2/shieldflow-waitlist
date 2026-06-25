"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import { z } from "zod";
import { policySaveSchema, policyCreateSchema } from "@/lib/validation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Company } from "@/lib/db/queries";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

/** getCompanyForUser + write-access check (auditors are read-only); DB outage returns inline error. */
async function companyOrError(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ company: Company } | { error: string }> {
  try {
    const company = await getCompanyForUser(supabase, userId);
    if (!company) return { error: "No company found." };
    const denied = await assertCanWrite(supabase, company.id, userId);
    if (denied) return { error: denied };
    return { company };
  } catch {
    return { error: DB_ERROR };
  }
}

/** Create a draft policy row (after the AI returns content) and return its id. */
export async function createPolicy(input: {
  title: string;
  body: string;
  frameworkId: string | null;
}) {
  const parsed = policyCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid policy data." };
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const res = await companyOrError(supabase, user.id);
  if ("error" in res) return { error: res.error };
  const company = res.company;

  const { data, error } = await supabase
    .from("policies")
    .insert({
      company_id: company.id,
      framework_id: parsed.data.frameworkId,
      title: parsed.data.title,
      body: parsed.data.body,
      status: "draft",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "Could not save the policy." };

  await logEvent(supabase, company.id, "policy.created", {
    type: "policy",
    id: data.id as string,
    label: parsed.data.title,
  });

  revalidatePath("/policies");
  return { ok: true, id: data.id as string };
}

export async function savePolicy(input: {
  id: string;
  title: string;
  body: string;
  status: "draft" | "final";
}) {
  const parsed = policySaveSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const res = await companyOrError(supabase, user.id);
  if ("error" in res) return { error: res.error };
  const company = res.company;

  const { error } = await supabase
    .from("policies")
    .update({
      title: parsed.data.title,
      body: parsed.data.body,
      status: parsed.data.status,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", company.id)
    .eq("id", parsed.data.id);

  if (error) return { error: "Could not save. Please try again." };

  await logEvent(supabase, company.id, "policy.updated", {
    type: "policy",
    id: parsed.data.id,
    label: parsed.data.title,
    metadata: { status: parsed.data.status },
  });

  revalidatePath("/policies");
  return { ok: true };
}

export async function deletePolicy(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid policy." };
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const res = await companyOrError(supabase, user.id);
  if ("error" in res) return { error: res.error };
  const company = res.company;

  const { data: existing } = await supabase
    .from("policies")
    .select("title")
    .eq("company_id", company.id)
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("policies")
    .delete()
    .eq("company_id", company.id)
    .eq("id", id);
  if (error) return { error: "Could not delete." };

  await logEvent(supabase, company.id, "policy.deleted", {
    type: "policy",
    id,
    label: (existing?.title as string | undefined) ?? undefined,
  });

  revalidatePath("/policies");
  return { ok: true };
}
