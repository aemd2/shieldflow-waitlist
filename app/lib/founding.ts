// Founding-cohort pricing. The earliest members get the steepest discount, and
// it steps down in groups of FOUNDING_TIER_SIZE: 100 → 80 → 60 → 40 → 20 → 0%.
// Whatever tier a member joins in is theirs for life (the Stripe coupon we apply
// at checkout uses duration=forever), so this never needs to change per member.

export const FOUNDING_TIER_SIZE = 5;
export const FOUNDING_DISCOUNTS = [100, 80, 60, 40, 20] as const; // then 0% (sold out)
export const FOUNDING_TOTAL_SPOTS = FOUNDING_TIER_SIZE * FOUNDING_DISCOUNTS.length; // 25

export type FoundingTier = {
  /** Discount the NEXT member to subscribe will receive (0 once all tiers are gone). */
  percent: number;
  /** 0 = the first/100%-off group, 1 = the second/80% group, … */
  tierIndex: number;
  /** Members still available at this same percent (includes the next one). */
  spotsLeftInTier: number;
  /** Founding members already in. */
  joined: number;
  /** Past every discounted tier — new members pay full price. */
  soldOut: boolean;
};

/** Resolve the tier a new member lands in, given how many have already joined. */
export function foundingTierFor(joined: number): FoundingTier {
  const safe = Math.max(0, Math.floor(joined || 0));
  const tierIndex = Math.floor(safe / FOUNDING_TIER_SIZE);
  if (tierIndex >= FOUNDING_DISCOUNTS.length) {
    return { percent: 0, tierIndex, spotsLeftInTier: 0, joined: safe, soldOut: true };
  }
  return {
    percent: FOUNDING_DISCOUNTS[tierIndex],
    tierIndex,
    spotsLeftInTier: FOUNDING_TIER_SIZE - (safe % FOUNDING_TIER_SIZE),
    joined: safe,
    soldOut: false,
  };
}

/** "the first 5", "the second 5", … for the current tier. */
export function foundingTierLabel(tierIndex: number): string {
  const ordinals = ["first", "second", "third", "fourth", "fifth"];
  return ordinals[tierIndex]
    ? `the ${ordinals[tierIndex]} ${FOUNDING_TIER_SIZE}`
    : "the founding cohort";
}

/** Apply a percent discount to a numeric amount (e.g. euros) for display. */
export function applyFoundingDiscount(amount: number, percent: number): number {
  return Math.round(amount * (100 - percent)) / 100;
}
