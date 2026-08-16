"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { assertFeature } from "@/lib/plan-server";
import { logEvent } from "@/lib/audit";
import { trustSettingsSchema } from "@/lib/validation";

export async function updateTrustSettings(input: { enabled: boolean; slug: string }) {
  const parsed = trustSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid settings." };
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let company;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return { error: "We couldn't reach the database. Please try again in a moment." };
  }
  if (!company) return { error: "No company found." };

  // Turning the Trust Center ON needs the plan; turning it OFF never does, so a
  // lapsed workspace can always take its public page down.
  const denied =
    (await assertCanWrite(supabase, company.id, user.id)) ??
    (parsed.data.enabled ? await assertFeature(supabase, company.id, "trust_center") : null);
  if (denied) return { error: denied };

  const { error } = await supabase
    .from("companies")
    .update({ trust_slug: parsed.data.slug, trust_enabled: parsed.data.enabled })
    .eq("id", company.id);

  if (error) {
    // Unique violation = another company already claimed this slug.
    if (error.code === "23505") {
      return { error: "That URL name is already taken — pick another." };
    }
    return { error: "Could not save settings. Please try again." };
  }

  await logEvent(supabase, company.id, "trust_center.updated", {
    type: "setting",
    label: "Trust Center",
    metadata: { enabled: parsed.data.enabled, slug: parsed.data.slug },
  });

  revalidatePath("/settings");
  return { ok: true };
}
