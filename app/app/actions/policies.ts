"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  assertCanWrite,
  getCallerAccess,
  getCompanyTeam,
  READ_ONLY_MESSAGE,
} from "@/lib/db/queries";
import { logEvent } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { z } from "zod";
import { policySaveSchema, policyCreateSchema } from "@/lib/validation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Company } from "@/lib/db/queries";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

/** getCompanyForUser + write-access check (auditors are read-only); DB outage returns inline error. */
async function companyOrError(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ company: Company } | { error: string }> {
  try {
    const company = await getCompanyForUser(supabase, userId);
    if (!company) return { error: "No company found." };
    const denied = await assertCanWrite(supabase, company.id, userId);
    if (denied) return { error: denied };
    return { company };
  } catch {
    return { error: DB_ERROR };
  }
}

/** Create a draft policy row (after the AI returns content) and return its id. */
export async function createPolicy(input: {
  title: string;
  body: string;
  frameworkId: string | null;
}) {
  const parsed = policyCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid policy data." };
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const res = await companyOrError(supabase, user.id);
  if ("error" in res) return { error: res.error };
  const company = res.company;

  const { data, error } = await supabase
    .from("policies")
    .insert({
      company_id: company.id,
      framework_id: parsed.data.frameworkId,
      title: parsed.data.title,
      body: parsed.data.body,
      status: "draft",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "Could not save the policy." };

  await logEvent(supabase, company.id, "policy.created", {
    type: "policy",
    id: data.id as string,
    label: parsed.data.title,
  });

  revalidatePath("/policies");
  return { ok: true, id: data.id as string };
}

export async function savePolicy(input: {
  id: string;
  title: string;
  body: string;
  status: "draft" | "final";
}) {
  const parsed = policySaveSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const res = await companyOrError(supabase, user.id);
  if ("error" in res) return { error: res.error };
  const company = res.company;

  // Editing the content of an approved/published policy invalidates both the
  // approval and everyone's acknowledgements — bump the version and reset the
  // lifecycle so it must be re-approved and re-acknowledged (acks are tied to a
  // specific version, so the old ones no longer count toward the new version).
  const { data: cur } = await supabase
    .from("policies")
    .select("approved_at, published_at, version")
    .eq("company_id", company.id)
    .eq("id", parsed.data.id)
    .maybeSingle();
  const wasLocked = Boolean(cur?.approved_at || cur?.published_at);

  const update: Record<string, unknown> = {
    title: parsed.data.title,
    body: parsed.data.body,
    status: parsed.data.status,
    updated_at: new Date().toISOString(),
  };
  if (wasLocked) {
    update.version = ((cur?.version as number) ?? 1) + 1;
    update.approved_by = null;
    update.approved_at = null;
    update.published_at = null;
  }

  const { error } = await supabase
    .from("policies")
    .update(update)
    .eq("company_id", company.id)
    .eq("id", parsed.data.id);

  if (error) return { error: "Could not save. Please try again." };

  await logEvent(supabase, company.id, "policy.updated", {
    type: "policy",
    id: parsed.data.id,
    label: parsed.data.title,
    metadata: { status: parsed.data.status, reapprovalRequired: wasLocked },
  });

  revalidatePath("/policies");
  return { ok: true };
}

/** Owner/admin gate for approve/publish (distinct from the member write gate). */
async function approverOrError(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ company: Company } | { error: string }> {
  try {
    const company = await getCompanyForUser(supabase, userId);
    if (!company) return { error: "No company found." };
    const access = await getCallerAccess(supabase, company.id, userId);
    if (!access || (access.role !== "owner" && access.role !== "admin")) {
      return { error: "Only an owner or admin can approve or publish policies." };
    }
    return { company };
  } catch {
    return { error: DB_ERROR };
  }
}

/** Approve a policy — stamps the approver of record + timestamp on the current version. */
export async function approvePolicy(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid policy." };
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const res = await approverOrError(supabase, user.id);
  if ("error" in res) return { error: res.error };

  const { data: pol } = await supabase
    .from("policies")
    .select("title")
    .eq("company_id", res.company.id)
    .eq("id", id)
    .maybeSingle();
  if (!pol) return { error: "Policy not found." };

  const { error } = await supabase
    .from("policies")
    .update({ approved_by: user.id, approved_at: new Date().toISOString() })
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not approve. Please try again." };

  await logEvent(supabase, res.company.id, "policy.approved", {
    type: "policy",
    id,
    label: pol.title as string,
  });

  revalidatePath("/policies");
  return { ok: true };
}

/** Publish an approved policy — opens it for acknowledgement and pings the team. */
export async function publishPolicy(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid policy." };
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const res = await approverOrError(supabase, user.id);
  if ("error" in res) return { error: res.error };

  const { data: pol } = await supabase
    .from("policies")
    .select("title, approved_at")
    .eq("company_id", res.company.id)
    .eq("id", id)
    .maybeSingle();
  if (!pol) return { error: "Policy not found." };
  if (!pol.approved_at) return { error: "Approve the policy before publishing it." };

  const { error } = await supabase
    .from("policies")
    .update({ published_at: new Date().toISOString() })
    .eq("company_id", res.company.id)
    .eq("id", id);
  if (error) return { error: "Could not publish. Please try again." };

  await logEvent(supabase, res.company.id, "policy.published", {
    type: "policy",
    id,
    label: pol.title as string,
  });

  // Ask every teammate to acknowledge (best-effort; never blocks the publish).
  // Auditors are excluded — the notification's only action is acknowledging,
  // which they're correctly barred from doing.
  try {
    const team = await getCompanyTeam(supabase, res.company.id);
    const memberIds = team.members.filter((m) => m.role !== "auditor").map((m) => m.user_id);
    if (memberIds.length > 0) {
      await notify(supabase, res.company.id, memberIds, {
        type: "policy",
        title: `Acknowledge: ${pol.title as string}`,
        body: "A policy was published and needs your acknowledgement.",
        link: "/policies",
      });
    }
  } catch {
    // best-effort
  }

  revalidatePath("/policies");
  return { ok: true };
}

/** A teammate acknowledges the current version of a published policy. */
export async function acknowledgePolicy(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid policy." };
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

  // Acknowledgement is an internal-workforce attestation, not a general company
  // write — but auditors are still read-only reviewers and must never create one.
  const access = await getCallerAccess(supabase, company.id, user.id);
  if (access?.role === "auditor") return { error: READ_ONLY_MESSAGE };

  const { data: pol } = await supabase
    .from("policies")
    .select("version, published_at, title")
    .eq("company_id", company.id)
    .eq("id", id)
    .maybeSingle();
  if (!pol) return { error: "Policy not found." };
  if (!pol.published_at) return { error: "This policy isn't published yet." };

  const { error } = await supabase.from("policy_acknowledgements").upsert(
    {
      policy_id: id,
      company_id: company.id,
      version: pol.version as number,
      user_id: user.id,
    },
    { onConflict: "policy_id,version,user_id", ignoreDuplicates: true },
  );
  if (error) return { error: "Could not record your acknowledgement. Please try again." };

  await logEvent(supabase, company.id, "policy.acknowledged", {
    type: "policy",
    id,
    label: pol.title as string,
    metadata: { version: pol.version },
  });

  revalidatePath("/policies");
  return { ok: true };
}

export async function deletePolicy(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid policy." };
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const res = await companyOrError(supabase, user.id);
  if ("error" in res) return { error: res.error };
  const company = res.company;

  const { data: existing } = await supabase
    .from("policies")
    .select("title")
    .eq("company_id", company.id)
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("policies")
    .delete()
    .eq("company_id", company.id)
    .eq("id", id);
  if (error) return { error: "Could not delete." };

  await logEvent(supabase, company.id, "policy.deleted", {
    type: "policy",
    id,
    label: (existing?.title as string | undefined) ?? undefined,
  });

  revalidatePath("/policies");
  return { ok: true };
}
