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
export type Limit = "frameworks" | "evidence" | "members";

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

const STARTER_FEATURES = ["ai_copilot", "ai_policy", "reports_export"] as const;

const GROWTH_FEATURES = [
  ...STARTER_FEATURES,
  "ai_questionnaire",
  "integrations",
  "vendors",
  "access_reviews",
  "questionnaires",
  "trust_center",
] as const;

export const PLANS: Record<PlanKey, PlanDef> = {
  free: {
    key: "free",
    name: "Free",
    blurb: "The compliance tracker, free forever — upgrade for automation.",
    // Deliberately keeps the core register usable: controls, policies, tasks,
    // risks and training all still work. What's gone is the automation (AI,
    // integrations) and the outward-facing surface (Trust Center).
    features: [],
    limits: { frameworks: 1, evidence: 25, members: 3 },
    paid: false,
  },
  tester: {
    key: "tester",
    name: "Tester",
    blurb: "Full access while your trial runs.",
    // Identical to Growth on purpose — a trial that hides features doesn't
    // tell the tester anything about the product they'd be buying.
    features: GROWTH_FEATURES,
    limits: { frameworks: Infinity, evidence: Infinity, members: 50 },
    paid: false,
  },
  starter: {
    key: "starter",
    name: "Starter",
    blurb: "Get your first framework audit-ready.",
    features: STARTER_FEATURES,
    limits: { frameworks: 2, evidence: 500, members: 10 },
    paid: true,
  },
  growth: {
    key: "growth",
    name: "Growth",
    blurb: "For scaling teams that need integrations.",
    features: GROWTH_FEATURES,
    // Unlimited rather than a number: the landing page sells "all 8 frameworks
    // included", and a hard count silently breaks that promise every time a
    // framework is added. This was 5 back when 5 was the whole library.
    limits: { frameworks: Infinity, evidence: Infinity, members: 50 },
    paid: true,
  },
  custom: {
    key: "custom",
    name: "Custom",
    blurb: "Tailored to your team, frameworks, and contract.",
    features: [...GROWTH_FEATURES, "sso"],
    limits: { frameworks: Infinity, evidence: Infinity, members: Infinity },
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
