"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, setControlStatus, assertCanWrite } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import type { ControlStatus } from "@/lib/score";

const VALID: ControlStatus[] = ["not_started", "in_progress", "complete"];

export async function updateControlStatus(controlId: string, status: string) {
  if (!VALID.includes(status as ControlStatus)) {
    return { error: "Invalid status." };
  }
  // A non-UUID id would surface as a raw Postgres cast error — reject it cleanly.
  if (!z.string().uuid().safeParse(controlId).success) {
    return { error: "Invalid control." };
  }
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  try {
    const company = await getCompanyForUser(supabase, user.id);
    if (!company) return { error: "No company found." };

    const denied = await assertCanWrite(supabase, company.id, user.id);
    if (denied) return { error: denied };

    // Snapshot the control code + prior status so the audit row reads
    // "AC-2: in progress → complete" rather than referencing a bare uuid.
    const { data: before } = await supabase
      .from("control_status")
      .select("status, controls(code)")
      .eq("company_id", company.id)
      .eq("control_id", controlId)
      .maybeSingle();
    const rel = before?.controls as { code?: string } | { code?: string }[] | null | undefined;
    const code = Array.isArray(rel) ? rel[0]?.code : rel?.code;

    await setControlStatus(supabase, company.id, controlId, status as ControlStatus, user.id);

    await logEvent(supabase, company.id, "control.status_changed", {
      type: "control",
      id: controlId,
      label: code,
      metadata: { from: before?.status, to: status },
    });
  } catch {
    return { error: "Could not save. Please try again in a moment." };
  }
  revalidatePath("/dashboard");
  revalidatePath(`/controls/${controlId}`);
  return { ok: true };
}
