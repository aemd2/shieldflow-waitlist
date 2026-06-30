"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, getCallerAccess, READ_ONLY_MESSAGE, type Company } from "@/lib/db/queries";
import { notificationPrefSchema } from "@/lib/validation";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

// Notifications belong to the signed-in user, so reading them (mark-read) is
// gated on identity, not the company write-role. Changing notification *prefs*
// is treated as a write — auditors are fully read-only and can't change them.
async function userCompany(): Promise<
  | { supabase: Awaited<ReturnType<typeof createServerSupabase>>; userId: string; company: Company }
  | { error: string }
> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  try {
    const company = await getCompanyForUser(supabase, user.id);
    if (!company) return { error: "No company found." };
    return { supabase, userId: user.id, company };
  } catch {
    return { error: DB_ERROR };
  }
}

export async function markNotificationRead(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid notification." };

  const res = await userCompany();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", res.userId)
    .is("read_at", null);
  if (error) return { error: "Could not update the notification." };

  revalidatePath("/notifications");
  return { ok: true };
}

export async function markAllNotificationsRead() {
  const res = await userCompany();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", res.userId)
    .eq("company_id", res.company.id)
    .is("read_at", null);
  if (error) return { error: "Could not update notifications." };

  revalidatePath("/notifications");
  return { ok: true };
}

export async function updateNotificationPref(input: unknown) {
  const parsed = notificationPrefSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid preference." };

  const res = await userCompany();
  if ("error" in res) return { error: res.error };

  // Auditors are fully read-only — they can't change notification settings.
  const access = await getCallerAccess(res.supabase, res.company.id, res.userId);
  if (access?.role === "auditor") return { error: READ_ONLY_MESSAGE };

  const { error } = await res.supabase
    .from("notification_prefs")
    .upsert(
      {
        user_id: res.userId,
        company_id: res.company.id,
        type: parsed.data.type,
        email_enabled: parsed.data.email_enabled,
        in_app_enabled: parsed.data.in_app_enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,company_id,type" },
    );
  if (error) return { error: "Could not save your preference." };

  revalidatePath("/settings");
  return { ok: true };
}
