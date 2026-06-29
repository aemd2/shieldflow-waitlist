"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite, type Company } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import { riskSchema } from "@/lib/validation";

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

function toRow(d: z.infer<typeof riskSchema>) {
  return {
    title: d.title,
    description: d.description || null,
    category: d.category || null,
    likelihood: d.likelihood,
    impact: d.impact,
    residual_likelihood: d.residual_likelihood || null,
    residual_impact: d.residual_impact || null,
    status: d.status,
    owner_email: d.owner_email || null,
    treatment: d.treatment || null,
    reviewed_at: new Date().toISOString().slice(0, 10),
  };
}

/** Replace a risk's control links with the given set (dedup; scoped to company). */
async function replaceRiskControls(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  companyId: string,
  riskId: string,
  controlIds: string[],
) {
  await supabase.from("risk_controls").delete().eq("company_id", companyId).eq("risk_id", riskId);
  const unique = [...new Set(controlIds)];
  if (unique.length > 0) {
    await supabase
      .from("risk_controls")
      .insert(unique.map((cid) => ({ risk_id: riskId, control_id: cid, company_id: companyId })));
  }
}

export async function createRisk(input: unknown) {
  const parsed = riskSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid risk data." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { data: created, error } = await res.supabase
    .from("risks")
    .insert({ company_id: res.company.id, ...toRow(parsed.data) })
    .select("id")
    .single();
  if (error || !created) return { error: "Could not add the risk. Please try again." };

  await replaceRiskControls(res.supabase, res.company.id, created.id as string, parsed.data.controlIds ?? []);

  await logEvent(res.supabase, res.company.id, "risk.created", {
    type: "risk",
    id: created.id as string,
    label: parsed.data.title,
    metadata: { likelihood: parsed.data.likelihood, impact: parsed.data.impact },
  });

  revalidatePath("/risks");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function updateRisk(id: string, input: unknown) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid risk." };
  const parsed = riskSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid risk data." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("risks")
    .update(toRow(parsed.data))
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not save the risk. Please try again." };

  await replaceRiskControls(res.supabase, res.company.id, id, parsed.data.controlIds ?? []);

  await logEvent(res.supabase, res.company.id, "risk.updated", {
    type: "risk",
    id,
    label: parsed.data.title,
    metadata: { likelihood: parsed.data.likelihood, impact: parsed.data.impact, status: parsed.data.status },
  });

  revalidatePath("/risks");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteRisk(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid risk." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { data: existing } = await res.supabase
    .from("risks")
    .select("title")
    .eq("company_id", res.company.id)
    .eq("id", id)
    .maybeSingle();

  const { error } = await res.supabase
    .from("risks")
    .delete()
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not delete the risk." };

  await logEvent(res.supabase, res.company.id, "risk.deleted", {
    type: "risk",
    id,
    label: (existing?.title as string | undefined) ?? undefined,
  });

  revalidatePath("/risks");
  revalidatePath("/dashboard");
  return { ok: true };
}
