"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { logEvent } from "@/lib/audit";
import { onboardingSchema } from "@/lib/validation";

export async function createCompanyAndOnboard(formData: FormData) {
  const parsed = onboardingSchema.safeParse({
    companyName: formData.get("companyName"),
    frameworkId: formData.get("frameworkId"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please fill in all fields." };
  }
  const { companyName, frameworkId } = parsed.data;

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Atomic: company + member + framework + seeded control_status in one transaction.
  // No partial state possible — eliminates orphan-company / redirect-loop bugs.
  const { data: companyId, error } = await supabase.rpc("create_company_with_framework", {
    p_name: companyName,
    p_framework_id: frameworkId,
  });
  if (error) {
    return { error: "Could not set up your workspace. Please try again." };
  }

  // The user is now a member (the RPC inserted the membership row), so this is
  // allowed to write the very first entry in the workspace's activity trail.
  if (typeof companyId === "string") {
    await logEvent(supabase, companyId, "company.created", {
      type: "company",
      id: companyId,
      label: companyName,
    });
  }

  // Bust the layout cache so the new company is visible immediately
  // (without this, the sidebar can be missing until the user manually refreshes).
  // New workspaces land on the guided 14-Day Sprint, not the empty dashboard.
  revalidatePath("/getting-started");
  redirect("/getting-started");
}
