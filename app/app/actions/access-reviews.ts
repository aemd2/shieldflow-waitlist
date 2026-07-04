"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, assertCanWrite, type Company } from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import { csvSafe } from "@/lib/csv";
import { newUuid } from "@/lib/uuid";
import { accessReviewCreateSchema, accessReviewDecisionSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { decryptSecret, encryptIfConfigured } from "@/lib/crypto";
import { fetchUsersRaw as fetchOktaUsersRaw, OktaError } from "@/lib/okta";
import { fetchWorkspaceUsers, refreshAccessToken, GoogleError } from "@/lib/google";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";
const ROSTER_PROVIDERS = ["okta", "google_workspace"] as const;
export type RosterProvider = (typeof ROSTER_PROVIDERS)[number];

async function companyOrError(): Promise<
  | { company: Company; supabase: Awaited<ReturnType<typeof createServerSupabase>>; userId: string }
  | { error: string }
> {
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
 * Live, on-demand roster pull for the "New review" form — no persistence, no
 * schema change. Reuses the exact credential-decrypt path each provider's own
 * sync already uses, so review creation never re-implements token handling.
 * Rate-limited separately from Sync so the two don't fight over one budget.
 */
export async function pullRosterFrom(provider: RosterProvider) {
  if (!ROSTER_PROVIDERS.includes(provider)) return { error: "Unsupported source." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };
  const { supabase, company } = res;

  if (!checkRateLimit(`access-review-pull:${company.id}:${provider}`, 3, 60_000)) {
    return { error: "Pulled recently — try again in a minute." };
  }

  const { data: integ } = await supabase
    .from("integrations")
    .select("id, access_token, refresh_token, token_expires_at, status, metadata")
    .eq("company_id", company.id)
    .eq("provider", provider)
    .maybeSingle();
  if (!integ || integ.status === "disconnected") {
    return { error: "That integration isn't connected yet." };
  }

  try {
    if (provider === "okta") {
      const meta = (integ.metadata ?? {}) as { host?: string };
      let creds: { host: string; token: string };
      try {
        creds = JSON.parse(decryptSecret(integ.access_token as string));
      } catch {
        return { error: "Stored credentials are corrupt — please reconnect Okta." };
      }
      const users = await fetchOktaUsersRaw(creds.host ?? meta.host ?? "", creds.token);
      return {
        ok: true as const,
        rows: users.map((u) => ({ subject: u.email, access: cap(u.status) })),
      };
    }

    // google_workspace
    let accessToken: string;
    try {
      accessToken = decryptSecret(integ.access_token as string);
    } catch {
      return { error: "Stored Google credentials are unreadable — please reconnect." };
    }
    const expiresAt = integ.token_expires_at ? new Date(integ.token_expires_at as string).getTime() : 0;
    if (expiresAt < Date.now() + 60_000) {
      if (!integ.refresh_token) return { error: "Google access expired. Please reconnect the integration." };
      const fresh = await refreshAccessToken(decryptSecret(integ.refresh_token as string));
      accessToken = fresh.access_token;
      const ttl = Number.isFinite(fresh.expires_in) ? fresh.expires_in : 3600;
      await supabase
        .from("integrations")
        .update({
          access_token: encryptIfConfigured(fresh.access_token),
          token_expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
          status: "connected",
        })
        .eq("id", integ.id);
    }
    const users = await fetchWorkspaceUsers(accessToken);
    return {
      ok: true as const,
      rows: users.map((u) => ({
        subject: u.primaryEmail,
        access: `${u.isAdmin ? "Admin" : "Member"}${u.suspended ? ", suspended" : ""}${u.isEnrolledIn2Sv ? "" : ", 2FA off"}`,
      })),
    };
  } catch (err) {
    if (err instanceof OktaError || err instanceof GoogleError) return { error: err.userMessage };
    return { error: "Couldn't pull the roster. Please try again." };
  }
}

function cap(s: string): string {
  const lower = s.toLowerCase();
  return lower ? lower[0].toUpperCase() + lower.slice(1) : s;
}

export async function createAccessReview(input: unknown) {
  const parsed = accessReviewCreateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid review." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { data: review, error } = await res.supabase
    .from("access_reviews")
    .insert({
      company_id: res.company.id,
      name: parsed.data.name,
      source: parsed.data.source || null,
      reviewer_email: parsed.data.reviewer_email || null,
      created_by: res.userId,
    })
    .select("id")
    .single();
  if (error || !review) return { error: "Could not create the review. Please try again." };

  const items = parsed.data.subjects.map((s) => ({
    review_id: review.id as string,
    company_id: res.company.id,
    subject: s.subject,
    access: s.access || null,
  }));
  const { error: itemsErr } = await res.supabase.from("access_review_items").insert(items);
  if (itemsErr) {
    await res.supabase.from("access_reviews").delete().eq("id", review.id); // compensate
    return { error: "Could not save the review rows. Please try again." };
  }

  await logEvent(res.supabase, res.company.id, "access_review.created", {
    type: "access_review",
    id: review.id as string,
    label: parsed.data.name,
    metadata: { subjects: parsed.data.subjects.length },
  });

  revalidatePath("/access-reviews");
  return { ok: true, id: review.id as string };
}

export async function decideAccessItem(input: unknown) {
  const parsed = accessReviewDecisionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { error } = await res.supabase
    .from("access_review_items")
    .update({
      decision: parsed.data.decision,
      note: parsed.data.note || null,
      decided_at: parsed.data.decision === "pending" ? null : new Date().toISOString(),
    })
    .eq("company_id", res.company.id)
    .eq("id", parsed.data.id);
  if (error) return { error: "Could not save the decision. Please try again." };

  revalidatePath("/access-reviews");
  return { ok: true };
}

export async function completeAccessReview(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid review." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { data: review } = await res.supabase
    .from("access_reviews")
    .select("name, source, reviewer_email, status")
    .eq("company_id", res.company.id)
    .eq("id", id)
    .maybeSingle();
  if (!review) return { error: "Review not found." };
  if (review.status === "completed") return { error: "This review is already completed." };

  const { data: items } = await res.supabase
    .from("access_review_items")
    .select("subject, access, decision, note")
    .eq("company_id", res.company.id)
    .eq("review_id", id);
  const rows = (items ?? []) as { subject: string; access: string | null; decision: string; note: string | null }[];
  if (rows.length === 0) return { error: "This review has no rows." };
  if (rows.some((r) => r.decision === "pending")) {
    return { error: "Decide keep or revoke on every row before completing." };
  }

  // Generate the evidence record: a frozen CSV of the attested decisions.
  const lines = [
    `# Access review: ${review.name}`,
    `# Source: ${review.source ?? "manual"} | Reviewer: ${review.reviewer_email ?? "—"} | Completed: ${new Date().toISOString()}`,
    ``,
    `subject,access,decision,note`,
    ...rows.map((r) => `${csvSafe(r.subject)},${csvSafe(r.access ?? "")},${csvSafe(r.decision)},${csvSafe(r.note ?? "")}`),
  ];
  const csv = lines.join("\n");
  const fileName = `access-review-${new Date().toISOString().slice(0, 10)}.csv`;
  const path = `${res.company.id}/access-reviews/${newUuid()}-${fileName}`;

  const { error: upErr } = await res.supabase.storage
    .from("evidence")
    .upload(path, new Blob([csv], { type: "text/csv" }), { contentType: "text/csv", upsert: false });
  if (upErr) return { error: "Could not store the evidence. Please try again." };

  const { data: ev, error: insErr } = await res.supabase
    .from("evidence")
    .insert({
      company_id: res.company.id,
      control_id: null,
      file_name: fileName,
      storage_path: path,
      mime_type: "text/csv",
      size_bytes: csv.length,
      note: `Access review "${review.name}" — ${rows.length} subjects attested.`,
      uploaded_by: res.userId,
    })
    .select("id")
    .single();
  if (insErr || !ev) {
    await res.supabase.storage.from("evidence").remove([path]);
    return { error: "Could not save the evidence record. Please try again." };
  }

  const { error } = await res.supabase
    .from("access_reviews")
    .update({ status: "completed", completed_at: new Date().toISOString(), evidence_id: ev.id })
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not complete the review. Please try again." };

  await logEvent(res.supabase, res.company.id, "access_review.completed", {
    type: "access_review",
    id,
    label: review.name as string,
    metadata: { subjects: rows.length, revoked: rows.filter((r) => r.decision === "revoke").length },
  });

  revalidatePath("/access-reviews");
  revalidatePath("/evidence");
  return { ok: true };
}

export async function deleteAccessReview(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid review." };

  const res = await companyOrError();
  if ("error" in res) return { error: res.error };

  const { data: existing } = await res.supabase
    .from("access_reviews")
    .select("name")
    .eq("company_id", res.company.id)
    .eq("id", id)
    .maybeSingle();

  const { error } = await res.supabase
    .from("access_reviews")
    .delete()
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not delete the review." };

  await logEvent(res.supabase, res.company.id, "access_review.deleted", {
    type: "access_review",
    id,
    label: (existing?.name as string | undefined) ?? undefined,
  });

  revalidatePath("/access-reviews");
  return { ok: true };
}
