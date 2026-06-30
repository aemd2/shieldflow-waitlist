"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, getCompanyTeam } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import { inviteSchema } from "@/lib/validation";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

// Maps the exceptions raised inside the accept_invite RPC to friendly messages.
function acceptErrorMessage(raw: string): string {
  if (raw.includes("invite_not_found")) return "This invite link is invalid or has been removed.";
  if (raw.includes("invite_used")) return "This invite has already been used or was revoked.";
  if (raw.includes("invite_email_mismatch"))
    return "This invite was sent to a different email. Sign in with that address to accept it.";
  if (raw.includes("already_in_company"))
    return "You're already part of a workspace. You can only belong to one at a time.";
  return "We couldn't accept this invite. Please try again.";
}

/** Owner-only: create a pending invite. The shareable link is built client-side from the token. */
export async function createInvite(input: {
  email: string;
  role: "admin" | "member" | "auditor";
  expiresInDays?: number;
}) {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid invite." };
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let company;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return { error: DB_ERROR };
  }
  if (!company) return { error: "No company found." };
  if (company.owner_user_id !== user.id) {
    return { error: "Only the workspace owner can invite teammates." };
  }
  if (parsed.data.email === (user.email ?? "").toLowerCase()) {
    return { error: "That's your own email — you're already on the team." };
  }

  // base64url so the token is URL-safe in the /join?token= link.
  const token = randomBytes(24).toString("base64url");

  // Time-box auditor access when requested (days → absolute timestamp).
  const days = parsed.data.expiresInDays ?? 0;
  const expiresAt =
    days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() : null;

  const { error } = await supabase.from("company_invites").insert({
    company_id: company.id,
    email: parsed.data.email,
    role: parsed.data.role,
    token,
    invited_by: user.id,
    expires_at: expiresAt,
  });
  if (error) return { error: "Could not create the invite. Please try again." };

  await logEvent(supabase, company.id, "member.invited", {
    type: "member",
    label: parsed.data.email,
    metadata: { role: parsed.data.role, expiresInDays: days || undefined },
  });

  revalidatePath("/settings");
  return { ok: true };
}

/** Owner-only: revoke a pending invite. RLS also enforces owner-only deletes. */
export async function revokeInvite(inviteId: string) {
  if (!z.string().uuid().safeParse(inviteId).success) return { error: "Invalid invite." };

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let company;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return { error: DB_ERROR };
  }
  if (!company) return { error: "No company found." };

  const { data: existing } = await supabase
    .from("company_invites")
    .select("email")
    .eq("id", inviteId)
    .eq("company_id", company.id)
    .maybeSingle();

  const { error } = await supabase
    .from("company_invites")
    .delete()
    .eq("id", inviteId)
    .eq("company_id", company.id);
  if (error) return { error: "Could not revoke the invite." };

  await logEvent(supabase, company.id, "invite.revoked", {
    type: "member",
    id: inviteId,
    label: (existing?.email as string | undefined) ?? undefined,
  });

  revalidatePath("/settings");
  return { ok: true };
}

/** Owner-only: remove a member. The remove_member RPC enforces owner-only + can't-remove-owner. */
export async function removeMember(userId: string) {
  if (!z.string().uuid().safeParse(userId).success) return { error: "Invalid member." };

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let company;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return { error: DB_ERROR };
  }
  if (!company) return { error: "No company found." };

  // Capture who's being removed *before* the delete, so the audit trail can name
  // them ("removed jane@acme.com") instead of a bare id. Best-effort — a lookup
  // failure must never block the removal itself.
  let removedEmail: string | undefined;
  try {
    const { members } = await getCompanyTeam(supabase, company.id);
    removedEmail = members.find((mm) => mm.user_id === userId)?.email;
  } catch {
    /* non-fatal — proceed without the email label */
  }

  const { error } = await supabase.rpc("remove_member", {
    p_company_id: company.id,
    p_user_id: userId,
  });
  if (error) {
    if (error.message.includes("cannot_remove_owner"))
      return { error: "The workspace owner can't be removed." };
    if (error.message.includes("not_authorized"))
      return { error: "Only the workspace owner can remove members." };
    return { error: "Could not remove the member." };
  }

  await logEvent(supabase, company.id, "member.removed", {
    type: "member",
    id: userId,
    label: removedEmail,
  });

  revalidatePath("/settings");
  return { ok: true };
}

/** Accept an invite by token (called from the /join page). */
export async function acceptInvite(token: string) {
  if (typeof token !== "string" || token.length < 10 || token.length > 200) {
    return { error: "This invite link looks invalid." };
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/join?token=${token}`)}`);

  const { data, error } = await supabase.rpc("accept_invite", { p_token: token });
  if (error) return { error: acceptErrorMessage(error.message) };

  const companyId = data as string;
  // Record the join in the activity trail. The user is now a member of this
  // company, so log_audit_event accepts the write; the actor (this user) is
  // derived server-side. Fail-safe — never blocks the join.
  await logEvent(supabase, companyId, "member.joined", {
    type: "member",
    id: user.id,
    label: user.email ?? undefined,
  });

  // Server-side redirect — most reliable pattern (Notion/Linear style).
  // The framework sends the redirect instruction to the browser directly,
  // bypassing any client-side router cache or session-refresh race.
  redirect("/dashboard");
}
