// Single source of truth for what each plan can do. Imported by both server
// gates and client UI, so the lock icon a user sees and the check that actually
// stops the request can never drift apart.
//
// Five plans:
//   free    — the always-on tier a workspace lands on with no subscription
//   tester  — a numbered invite link (see /trial/[code]); full Growth access for
//             14 days, then it lapses back to free. Never charges anything.
//   starter — paid, single-framework teams
//   growth  — paid, everything
//   custom  — negotiated; unlimited
//
// Founding-cohort discounts (100% → 80% → …) are orthogonal: they change the
// PRICE of starter/growth, never the feature set. See lib/founding.ts.

export type PlanKey = "free" | "tester" | "starter" | "growth" | "custom";

/** Everything that can be switched off on a cheaper plan. */
export type Feature =
  | "ai_copilot"
  | "ai_policy"
  | "ai_questionnaire"
  | "integrations"
  | "vendors"
  | "access_reviews"
  | "questionnaires"
  | "trust_center"
  | "reports_export"
  | "sso";

/** Countable things. Infinity = no cap. */
export type Limit =
  | "frameworks"
  | "evidence"
  | "members"
  | "integrations"
  | "vendors"
  | "access_reviews"
  | "questionnaires";

export interface PlanDef {
  key: PlanKey;
  name: string;
  /** Shown on the upgrade prompt when a locked feature is hit. */
  blurb: string;
  features: readonly Feature[];
  limits: Readonly<Record<Limit, number>>;
  /** Paid plans route through Stripe checkout; free/tester never do. */
  paid: boolean;
}

/**
 * AI is available on every plan, Free included.
 *
 * It used to be the first thing a lapsed workspace lost, on the reasoning that
 * "AI costs real money per call". That is no longer true — the models we use sit
 * on Groq's free tier. Gating the most distinctive part of the product behind a
 * paywall cost more in evaluation than it saved in inference.
 *
 * The real constraint is now a shared rate limit rather than a bill: Groq's free
 * tier allows 8,000 tokens/minute across the whole account, not per customer. If
 * Free-plan usage starts crowding out paying workspaces, the answer is per-plan
 * rate limits in lib/rate-limit.ts, not removing the feature again.
 */
const AI_FEATURES = ["ai_copilot", "ai_policy", "ai_questionnaire"] as const;

/**
 * On every plan, Free included.
 *
 * The Trust Center joins the AI here for a different reason: it costs us almost
 * nothing to serve (the public page is cached per slug and reads aggregates
 * through one anon RPC) and every workspace that publishes one is a page on our
 * domain pointing back at us. Gating our own distribution behind a paywall was
 * the wrong trade.
 */
const FREE_FEATURES = [
  ...AI_FEATURES,
  "trust_center",
  "integrations",
  "vendors",
  "access_reviews",
  "questionnaires",
] as const;

const STARTER_FEATURES = [...FREE_FEATURES, "reports_export"] as const;

// Same feature set as Starter on purpose. Since 2026-09-02 the tiers differ by
// LIMIT rather than by access: every workspace can reach every module, and the
// plan decides how many of each you get. Simpler to explain than a feature
// matrix, and it means a Free user hits a wall they understand ("you have 3 of
// 3 integrations") instead of one they resent ("not on your plan").
const GROWTH_FEATURES = [...STARTER_FEATURES] as const;

export const PLANS: Record<PlanKey, PlanDef> = {
  free: {
    key: "free",
    name: "Free",
    blurb: "The compliance tracker with AI and a public Trust Center, free forever.",
    // Nothing is hidden — every module is reachable. Free gets 3 of each of the
    // countable things, which is enough to genuinely evaluate the product
    // (connect a cloud, a repo and an IdP; assess three vendors) without it
    // serving as a free tier for a real compliance programme.
    features: [...FREE_FEATURES],
    limits: {
      frameworks: 1,
      evidence: 25,
      members: 3,
      integrations: 3,
      vendors: 3,
      access_reviews: 3,
      questionnaires: 3,
    },
    paid: false,
  },
  tester: {
    key: "tester",
    name: "Tester",
    blurb: "Full access while your trial runs.",
    // Identical to Growth on purpose — a trial that hides features doesn't
    // tell the tester anything about the product they'd be buying.
    features: GROWTH_FEATURES,
    limits: {
      frameworks: Infinity,
      evidence: Infinity,
      members: 50,
      integrations: Infinity,
      vendors: Infinity,
      access_reviews: Infinity,
      questionnaires: Infinity,
    },
    paid: false,
  },
  starter: {
    key: "starter",
    name: "Starter",
    blurb: "Get your first framework audit-ready.",
    features: STARTER_FEATURES,
    limits: {
      frameworks: 2,
      evidence: 500,
      members: 10,
      integrations: 6,
      vendors: 6,
      access_reviews: 6,
      questionnaires: 6,
    },
    paid: true,
  },
  growth: {
    key: "growth",
    name: "Growth",
    blurb: "For scaling teams that need integrations.",
    features: GROWTH_FEATURES,
    // Unlimited across the board: Growth is "the whole product". A hard count
    // here silently breaks the landing page's "all 8 frameworks included" every
    // time a framework is added — frameworks was 5 back when 5 was the library.
    limits: {
      frameworks: Infinity,
      evidence: Infinity,
      members: 50,
      integrations: Infinity,
      vendors: Infinity,
      access_reviews: Infinity,
      questionnaires: Infinity,
    },
    paid: true,
  },
  custom: {
    key: "custom",
    name: "Custom",
    blurb: "Tailored to your team, frameworks, and contract.",
    features: [...GROWTH_FEATURES, "sso"],
    limits: {
      frameworks: Infinity,
      evidence: Infinity,
      members: Infinity,
      integrations: Infinity,
      vendors: Infinity,
      access_reviews: Infinity,
      questionnaires: Infinity,
    },
    paid: true,
  },
};

export const TESTER_TRIAL_DAYS = 14;

/** Human label for a locked feature, used in upgrade prompts. */
export const FEATURE_LABELS: Record<Feature, string> = {
  ai_copilot: "AI Co-Pilot",
  ai_policy: "AI Policy Generator",
  ai_questionnaire: "AI questionnaire answers",
  integrations: "Integrations",
  vendors: "Vendor risk management",
  access_reviews: "Access reviews",
  questionnaires: "Security questionnaires",
  trust_center: "Trust Center",
  reports_export: "Report export",
  sso: "SSO / SAML",
};

/** The cheapest plan that includes a feature — drives "Available on X" copy. */
export function cheapestPlanWith(feature: Feature): PlanDef {
  const order: PlanKey[] = ["free", "starter", "growth", "custom"];
  for (const key of order) {
    if (PLANS[key].features.includes(feature)) return PLANS[key];
  }
  return PLANS.custom;
}

export function planAllows(plan: PlanKey, feature: Feature): boolean {
  return PLANS[plan].features.includes(feature);
}

export function planLimit(plan: PlanKey, limit: Limit): number {
  return PLANS[plan].limits[limit];
}

/** Whole days remaining, floored at 0. `null` for a workspace with no trial. */
export function trialDaysLeft(trialEndsAt: string | null | undefined): number | null {
  if (!trialEndsAt) return null;
  const ms = new Date(trialEndsAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function isTrialActive(trialEndsAt: string | null | undefined): boolean {
  if (!trialEndsAt) return false;
  const t = new Date(trialEndsAt).getTime();
  return !Number.isNaN(t) && t > Date.now();
}

/**
 * Resolve the effective plan from raw workspace state. Pure, so the same rule
 * runs on the server gate and in the client banner.
 *
 * A live paid subscription always wins — if someone on a Tester trial
 * subscribes on day 3, they're a paying customer immediately and the leftover
 * trial days are irrelevant. Otherwise an unexpired trial makes them a tester,
 * and everything else is free.
 */
export function resolvePlan(input: {
  subscriptionPlan?: string | null;
  subscriptionStatus?: string | null;
  trialEndsAt?: string | null;
}): PlanKey {
  const { subscriptionPlan, subscriptionStatus, trialEndsAt } = input;

  // past_due/unpaid keep access while Stripe retries the card — dropping a
  // paying customer to Free on a failed retry would be a support nightmare.
  const LIVE = ["active", "trialing", "past_due", "unpaid"];
  if (subscriptionPlan && subscriptionStatus && LIVE.includes(subscriptionStatus)) {
    if (subscriptionPlan in PLANS) {
      const key = subscriptionPlan as PlanKey;
      if (PLANS[key].paid) return key;
    }
  }

  if (isTrialActive(trialEndsAt)) return "tester";
  return "free";
}
