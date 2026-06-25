"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite, type Company } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import { vendorSchema } from "@/lib/validation";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

// Every vendor action is a write — resolve the company and confirm write access
// (auditors are read-only) in one place.
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

export async function createVendor(input: unknown) {
  const parsed = vendorSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid vendor data." };
  }

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase.from("vendors").insert({
    company_id: res.company.id,
    name: parsed.data.name,
    website: parsed.data.website || null,
    category: parsed.data.category || null,
    risk_level: parsed.data.risk_level,
    status: parsed.data.status,
    notes: parsed.data.notes || null,
    reviewed_at: new Date().toISOString().slice(0, 10),
  });
  if (error) return { error: "Could not add the vendor. Please try again." };

  await logEvent(res.supabase, res.company.id, "vendor.created", {
    type: "vendor",
    label: parsed.data.name,
    metadata: { risk_level: parsed.data.risk_level },
  });

  revalidatePath("/vendors");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function updateVendor(id: string, input: unknown) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid vendor." };
  const parsed = vendorSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid vendor data." };
  }

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("vendors")
    .update({
      name: parsed.data.name,
      website: parsed.data.website || null,
      category: parsed.data.category || null,
      risk_level: parsed.data.risk_level,
      status: parsed.data.status,
      notes: parsed.data.notes || null,
      reviewed_at: new Date().toISOString().slice(0, 10),
    })
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not save the vendor. Please try again." };

  await logEvent(res.supabase, res.company.id, "vendor.updated", {
    type: "vendor",
    id,
    label: parsed.data.name,
    metadata: { risk_level: parsed.data.risk_level, status: parsed.data.status },
  });

  revalidatePath("/vendors");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteVendor(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid vendor." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { data: existing } = await res.supabase
    .from("vendors")
    .select("name")
    .eq("company_id", res.company.id)
    .eq("id", id)
    .maybeSingle();

  const { error } = await res.supabase
    .from("vendors")
    .delete()
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not delete the vendor." };

  await logEvent(res.supabase, res.company.id, "vendor.deleted", {
    type: "vendor",
    id,
    label: (existing?.name as string | undefined) ?? undefined,
  });

  revalidatePath("/vendors");
  revalidatePath("/dashboard");
  return { ok: true };
}
