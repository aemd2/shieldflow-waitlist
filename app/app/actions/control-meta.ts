"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, setControlMeta, assertCanWrite, getCompanyTeam } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import { notify } from "@/lib/notify";
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
    // Capture the prior owner so we only notify on a genuine re-assignment.
    const { data: prev } = await supabase
      .from("control_status")
      .select("owner_email")
      .eq("company_id", company.id)
      .eq("control_id", parsed.data.controlId)
      .maybeSingle();
    const prevOwner = (prev?.owner_email as string | null) ?? null;

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

    // Notify a newly-assigned teammate (best-effort — never breaks the save).
    const newOwner = parsed.data.owner_email || null;
    if (newOwner && newOwner.toLowerCase() !== (prevOwner ?? "").toLowerCase()) {
      try {
        const team = await getCompanyTeam(supabase, company.id);
        const member = team.members.find(
          (m) => m.email.toLowerCase() === newOwner.toLowerCase(),
        );
        if (member && member.user_id !== user.id) {
          await notify(supabase, company.id, [member.user_id], {
            type: "control",
            title: `You were assigned control ${ctrl?.code ?? ""}`.trim(),
            body: "You're now the owner of a control in ShieldFlow.",
            link: `/controls/${parsed.data.controlId}`,
          });
        }
      } catch {
        // best-effort notification
      }
    }
  } catch {
    return { error: "Could not save. Please try again." };
  }

  revalidatePath(`/controls/${parsed.data.controlId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}
