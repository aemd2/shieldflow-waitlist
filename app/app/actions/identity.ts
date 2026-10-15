"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

// An email, or a provider account with no email behind it ("github:octocat").
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .refine((v) => z.string().email().safeParse(v).success || /^[a-z0-9_]+:[^\s:]{1,200}$/.test(v));
const reasonSchema = z.string().trim().max(200).optional();

async function companyOrError() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  try {
    const company = await getCompanyForUser(supabase, user.id);
    if (!company) return { error: "No company found." };
    const denied = await assertCanWrite(supabase, company.id, user.id);
    if (denied) return { error: denied };
    return { company, supabase, userId: user.id };
  } catch {
    return { error: DB_ERROR };
  }
}

/**
 * "That account isn't a person."
 *
 * Exempts one address from the untracked-accounts check. We record who said so
 * and why rather than inferring it from the address, because the judgement is
 * itself the evidence: an auditor asking "why is svc-deploy@ not in your
 * personnel register?" wants a person's answer, not a regex.
 *
 * Deliberately does NOT re-run the check. The next sync recomputes it, and
 * forcing a provider round-trip on a click would make the button slow and put
 * the exemption behind a rate limit.
 */
export async function dismissIdentityAccount(email: unknown, reason?: unknown) {
  const parsedEmail = emailSchema.safeParse(email);
  if (!parsedEmail.success) return { error: "That doesn't look like an email address or an account." };
  const parsedReason = reasonSchema.safeParse(reason ?? undefined);
  if (!parsedReason.success) return { error: "That reason is too long." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase.from("identity_exceptions").upsert(
    {
      company_id: res.company.id,
      email: parsedEmail.data,
      reason: parsedReason.data || null,
      created_by: res.userId,
    },
    { onConflict: "company_id,email" },
  );
  if (error) return { error: "Could not save that. Please try again." };

  await logEvent(res.supabase, res.company.id, "identity_exception.created", {
    type: "integration",
    label: parsedEmail.data,
    metadata: { reason: parsedReason.data || null },
  });

  revalidatePath("/personnel");
  revalidatePath("/integrations", "layout");
  return { ok: true };
}

/** Undo a dismissal — the account goes back to being a finding on the next sync. */
export async function restoreIdentityAccount(email: unknown) {
  const parsedEmail = emailSchema.safeParse(email);
  if (!parsedEmail.success) return { error: "That doesn't look like an email address or an account." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("identity_exceptions")
    .delete()
    .eq("company_id", res.company.id)
    .eq("email", parsedEmail.data);
  if (error) return { error: "Could not undo that. Please try again." };

  await logEvent(res.supabase, res.company.id, "identity_exception.removed", {
    type: "integration",
    label: parsedEmail.data,
  });

  revalidatePath("/personnel");
  return { ok: true };
}

const linkSchema = z.object({
  provider: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{2,40}$/),
  account: z.string().trim().toLowerCase().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(320),
});

/**
 * "This GitHub login is Jane." Recorded once, used by every scan from then on to
 * match the account to Personnel — so a leaver's login is caught and a known
 * colleague stops showing up as nobody's.
 */
export async function linkIdentity(input: unknown) {
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { error: "Pick a person from Personnel." };
  const res = await companyOrError();
  if ("error" in res) return { error: res.error };
  const { provider, account, email } = parsed.data;

  const { data: person } = await res.supabase.from("personnel").select("id").eq("company_id", res.company.id).ilike("email", email).maybeSingle();
  if (!person) return { error: "That address isn't in Personnel." };

  // No update policy on purpose: replace = delete + insert, both logged as one change.
  await res.supabase.from("identity_links").delete().eq("company_id", res.company.id).eq("provider", provider).eq("account", account);
  const { error } = await res.supabase
    .from("identity_links")
    .insert({ company_id: res.company.id, provider, account, email, created_by: res.userId });
  if (error) return { error: "Could not save that. Please try again." };

  await logEvent(res.supabase, res.company.id, "identity_link.created", {
    type: "integration",
    label: `${provider}:${account}`,
    metadata: { email },
  });
  revalidatePath(`/integrations/${provider === "google" ? "google_workspace" : provider}`);
  return { ok: true };
}

export async function unlinkIdentity(input: unknown) {
  const parsed = linkSchema.pick({ provider: true, account: true }).safeParse(input);
  if (!parsed.success) return { error: "Unknown account." };
  const res = await companyOrError();
  if ("error" in res) return { error: res.error };
  const { provider, account } = parsed.data;
  const { error } = await res.supabase.from("identity_links").delete().eq("company_id", res.company.id).eq("provider", provider).eq("account", account);
  if (error) return { error: "Could not undo that. Please try again." };
  await logEvent(res.supabase, res.company.id, "identity_link.removed", { type: "integration", label: `${provider}:${account}` });
  revalidatePath(`/integrations/${provider === "google" ? "google_workspace" : provider}`);
  return { ok: true };
}
