// Server-side plan resolution + the gates that actually stop a request.
//
// The effective plan is always DERIVED (live subscription + companies.trial_ends_at),
// never a stored flag — so a Tester trial lapses to Free the moment the clock
// runs out, with no cron job to fall behind and no row to go stale.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase, isAdminConfigured } from "@/lib/supabase/admin";
import {
  PLANS,
  FEATURE_LABELS,
  cheapestPlanWith,
  planAllows,
  planLimit,
  resolvePlan,
  trialDaysLeft,
  isTrialActive,
  type Feature,
  type Limit,
  type PlanKey,
} from "@/lib/plan";

export interface CompanyPlan {
  plan: PlanKey;
  trialEndsAt: string | null;
  /** Whole days left in the trial, or null if there's no trial. */
  daysLeft: number | null;
  trialActive: boolean;
  /** Had a Tester trial and it has run out — drives the "trial ended" banner. */
  trialExpired: boolean;
  trialCode: string | null;
  subscriptionStatus: string | null;
}

/** Resolve the plan a workspace is really on right now. */
export async function getCompanyPlan(
  supabase: SupabaseClient,
  companyId: string,
): Promise<CompanyPlan> {
  const [companyRes, subRes] = await Promise.all([
    supabase
      .from("companies")
      .select("trial_ends_at, trial_code")
      .eq("id", companyId)
      .maybeSingle(),
    supabase
      .from("subscriptions")
      .select("plan, status")
      .eq("company_id", companyId)
      .maybeSingle(),
  ]);

  const company = companyRes.data as { trial_ends_at: string | null; trial_code: string | null } | null;
  const sub = subRes.data as { plan: string | null; status: string | null } | null;

  const trialEndsAt = company?.trial_ends_at ?? null;
  const plan = resolvePlan({
    subscriptionPlan: sub?.plan ?? null,
    subscriptionStatus: sub?.status ?? null,
    trialEndsAt,
  });
  const trialActive = isTrialActive(trialEndsAt);

  return {
    plan,
    trialEndsAt,
    daysLeft: trialDaysLeft(trialEndsAt),
    trialActive,
    trialExpired: Boolean(trialEndsAt) && !trialActive && plan === "free",
    trialCode: company?.trial_code ?? null,
    subscriptionStatus: sub?.status ?? null,
  };
}

/**
 * Plan behind a public Trust Center slug. The trust page is anonymous — there's
 * no session to resolve a company from — so this goes through the service-role
 * client. Returns null when the slug matches nothing.
 *
 * Without this the Trust Center would stay online after a Tester trial lapsed,
 * which is the one locked feature the outside world can still see.
 */
export async function planForTrustSlug(slug: string): Promise<PlanKey | null> {
  if (!isAdminConfigured()) return null;
  try {
    const admin = createAdminSupabase();
    const { data: company } = await admin
      .from("companies")
      .select("id, trial_ends_at")
      .eq("trust_slug", slug)
      .maybeSingle();
    if (!company) return null;

    const c = company as { id: string; trial_ends_at: string | null };
    const { data: sub } = await admin
      .from("subscriptions")
      .select("plan, status")
      .eq("company_id", c.id)
      .maybeSingle();
    const s = sub as { plan: string | null; status: string | null } | null;

    return resolvePlan({
      subscriptionPlan: s?.plan ?? null,
      subscriptionStatus: s?.status ?? null,
      trialEndsAt: c.trial_ends_at,
    });
  } catch {
    return null;
  }
}

/** Upgrade copy for a locked feature — one wording, used everywhere. */
export function upgradeMessage(feature: Feature): string {
  const needed = cheapestPlanWith(feature);
  return `${FEATURE_LABELS[feature]} isn't included on your current plan. It's available on ${needed.name} — see Billing to upgrade.`;
}

/**
 * Returns a friendly upgrade message if the workspace's plan doesn't include
 * `feature`, else null. Mirrors assertCanWrite() in lib/db/queries.ts so both
 * gates read the same at every call site:
 *
 *   const denied = await assertCanWrite(...) ?? await assertFeature(...);
 *   if (denied) return { error: denied };
 */
export async function assertFeature(
  supabase: SupabaseClient,
  companyId: string,
  feature: Feature,
): Promise<string | null> {
  const { plan } = await getCompanyPlan(supabase, companyId);
  return planAllows(plan, feature) ? null : upgradeMessage(feature);
}

const LIMIT_NOUNS: Record<Limit, string> = {
  frameworks: "frameworks",
  evidence: "evidence files",
  members: "team members",
};

/**
 * Returns a friendly message if adding one more would exceed the plan's cap.
 * `current` is the count BEFORE the new item.
 */
export async function assertWithinLimit(
  supabase: SupabaseClient,
  companyId: string,
  limit: Limit,
  current: number,
): Promise<string | null> {
  const { plan } = await getCompanyPlan(supabase, companyId);
  const cap = planLimit(plan, limit);
  if (current < cap) return null;

  // Name the next plan up that would actually raise this cap.
  const order: PlanKey[] = ["starter", "growth", "custom"];
  const next = order.find((k) => planLimit(k, limit) > cap);
  const suffix = next
    ? ` ${PLANS[next].name} allows ${
        planLimit(next, limit) === Infinity ? "unlimited" : planLimit(next, limit)
      } — see Billing to upgrade.`
    : "";

  return `Your ${PLANS[plan].name} plan includes ${cap} ${LIMIT_NOUNS[limit]}.${suffix}`;
}
