"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, getCallerAccess, type Company } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import { ssoDomainSchema } from "@/lib/validation";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

// SSO domain mapping is owner-only — it controls who auto-joins the workspace.
async function ownerOrError(): Promise<
  | { supabase: Awaited<ReturnType<typeof createServerSupabase>>; company: Company; email: string }
  | { error: string }
> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  try {
    const company = await getCompanyForUser(supabase, user.id);
    if (!company) return { error: "No company found." };
    const access = await getCallerAccess(supabase, company.id, user.id);
    if (!access || access.role !== "owner") {
      return { error: "Only the workspace owner can manage SSO domains." };
    }
    return { supabase, company, email: user.email ?? "" };
  } catch {
    return { error: DB_ERROR };
  }
}

export async function addSsoDomain(input: unknown) {
  const parsed = ssoDomainSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid domain." };

  const res = await ownerOrError();
  if ("error" in res) return { error: res.error };

  // Auto-verify when the domain matches the owner's own email domain (they
  // demonstrably control it). Other domains stay unverified — and unverified
  // domains never auto-join anyone — until DNS verification (a future step).
  const ownerDomain = res.email.split("@")[1]?.toLowerCase() ?? "";
  const verified = ownerDomain !== "" && ownerDomain === parsed.data.domain;

  const { error } = await res.supabase
    .from("company_sso_domains")
    .insert({ company_id: res.company.id, domain: parsed.data.domain, verified });
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "That domain is already claimed by a workspace." };
    }
    return { error: "Could not add the domain. Please try again." };
  }

  await logEvent(res.supabase, res.company.id, "sso.domain_added", {
    type: "setting",
    label: parsed.data.domain,
    metadata: { verified },
  });

  revalidatePath("/settings");
  return { ok: true, verified };
}

export async function removeSsoDomain(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid domain." };

  const res = await ownerOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("company_sso_domains")
    .delete()
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not remove the domain." };

  revalidatePath("/settings");
  return { ok: true };
}
