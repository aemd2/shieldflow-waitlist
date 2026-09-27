"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, getCallerAccess, addFrameworkToCompany, listFrameworks } from "@/lib/db/queries";
import { assertWithinLimit } from "@/lib/plan-server";
import { addFrameworkSchema } from "@/lib/validation";
import { logEvent } from "@/lib/audit";
import { propagateMeasuresToControls } from "@/lib/measures";

/**
 * Add a second (or third...) compliance framework to an already-onboarded
 * company. Seeds that framework's controls at 'not_started' via the existing
 * add_framework_to_company() RPC (idempotent — safe to call twice), then credits
 * them with any measures the company has already started. Owner/admin
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

  // Plan cap. Counted before the insert, and re-adding a framework the company
  // already has stays free (the underlying RPC is idempotent) so a workspace at
  // its cap never gets a confusing error for a no-op.
  const { data: existing } = await supabase
    .from("company_frameworks")
    .select("framework_id")
    .eq("company_id", company.id);
  const owned = (existing ?? []) as { framework_id: string }[];
  if (!owned.some((f) => f.framework_id === framework.id)) {
    const capped = await assertWithinLimit(supabase, company.id, "frameworks", owned.length);
    if (capped) return { error: capped };
  }

  try {
    await addFrameworkToCompany(supabase, company.id, framework.id);
  } catch {
    return { error: "Could not add that framework. Please try again." };
  }

  // Credit the new framework with work already done. add_framework_to_company
  // seeds every one of its requirements as not started and never looks at
  // measure_status, so a company that finished its SOC 2 work and then switched
  // on NIS2 saw NIS2 at 0% — while the measures page listed those same NIS2
  // requirements as satisfied. That is "do the work once" failing at exactly the
  // moment a second framework is added, which is the moment it's supposed to pay
  // off.
  //
  // Propagation is advance-only and skips frameworks the company doesn't have,
  // so passing every started measure is safe: existing frameworks are already at
  // or above what it derives, and only the freshly seeded rows move.
  const { data: started } = await supabase
    .from("measure_status")
    .select("measure_id")
    .eq("company_id", company.id)
    .neq("status", "not_started");
  const credited = await propagateMeasuresToControls(
    supabase,
    company.id,
    ((started ?? []) as { measure_id: string }[]).map((s) => s.measure_id),
    user.id,
  );

  await logEvent(supabase, company.id, "framework.added", {
    type: "framework",
    id: framework.id,
    label: framework.name,
    metadata: { credited_from_existing_work: credited },
  });

  // /getting-started too: computeSprint() there reads the same combined
  // controls set and needs to reflect the new framework's controls — now
  // including the ones credited from existing work.
  revalidatePath("/dashboard");
  revalidatePath("/getting-started");
  revalidatePath("/controls");
  return { ok: true, name: framework.name, credited };
}
