"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, getCallerAccess, addFrameworkToCompany, listFrameworks } from "@/lib/db/queries";
import { addFrameworkSchema } from "@/lib/validation";
import { logEvent } from "@/lib/audit";

/**
 * Add a second (or third...) compliance framework to an already-onboarded
 * company. Seeds that framework's controls at 'not_started' via the existing
 * add_framework_to_company() RPC (idempotent — safe to call twice). Owner/admin
 * only: this is workspace-configuration scope (matches Billing's gate), not
 * routine member-level work, and the RPC's own internal check is only
 * "is a company member" — permissive enough to let an auditor through if
 * called directly, so this gate is the real enforcement point.
 */
export async function addFramework(input: unknown) {
  const parsed = addFrameworkSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Pick a framework." };

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) return { error: "No company found." };

  const access = await getCallerAccess(supabase, company.id, user.id);
  if (access?.role !== "owner" && access?.role !== "admin") {
    return { error: "Only the workspace owner or an admin can add a framework." };
  }

  const frameworks = await listFrameworks(supabase).catch(() => []);
  const framework = frameworks.find((f) => f.id === parsed.data.frameworkId);
  if (!framework) return { error: "That framework doesn't exist." };

  try {
    await addFrameworkToCompany(supabase, company.id, framework.id);
  } catch {
    return { error: "Could not add that framework. Please try again." };
  }

  await logEvent(supabase, company.id, "framework.added", {
    type: "framework",
    id: framework.id,
    label: framework.name,
  });

  // /getting-started too: computeSprint() there reads the same combined
  // controls set and needs to reflect the newly-seeded (0%) controls.
  revalidatePath("/dashboard");
  revalidatePath("/getting-started");
  return { ok: true, name: framework.name };
}
