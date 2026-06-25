"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, setControlMeta, assertCanWrite } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import { controlMetaSchema } from "@/lib/validation";

export async function updateControlMeta(input: {
  controlId: string;
  owner_email: string;
  due_date: string;
  notes: string;
}) {
  const parsed = controlMetaSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
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

  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { error: denied };

  try {
    await setControlMeta(
      supabase,
      company.id,
      parsed.data.controlId,
      {
        owner_email: parsed.data.owner_email ? parsed.data.owner_email : null,
        due_date: parsed.data.due_date ? parsed.data.due_date : null,
        notes: parsed.data.notes ? parsed.data.notes : null,
      },
      user.id,
    );

    const { data: ctrl } = await supabase
      .from("controls")
      .select("code")
      .eq("id", parsed.data.controlId)
      .maybeSingle();

    await logEvent(supabase, company.id, "control.updated", {
      type: "control",
      id: parsed.data.controlId,
      label: ctrl?.code as string | undefined,
      metadata: {
        owner_email: parsed.data.owner_email || null,
        due_date: parsed.data.due_date || null,
      },
    });
  } catch {
    return { error: "Could not save. Please try again." };
  }

  revalidatePath(`/controls/${parsed.data.controlId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}
