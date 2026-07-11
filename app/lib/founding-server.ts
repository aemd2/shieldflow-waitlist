// Server-only side of founding-cohort pricing: counting how many spots are taken
// (admin client, so it sees every company's subscription, not just the caller's)
// and minting the lifetime Stripe coupons that lock a member's rate forever.
import "server-only";
import { createAdminSupabase, isAdminConfigured } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { foundingTierFor, type FoundingTier } from "@/lib/founding";

// A subscription occupies a founding spot while it's live. Canceled / never-started
// ones free the spot back up, so we don't count them.
const COUNTED_STATUSES = ["active", "trialing", "past_due", "unpaid"];

/** How many companies currently hold a founding spot (global count, RLS-bypassing).
 * Excludes companies owned by known test accounts (see the `test_accounts` table,
 * migration 0033) so our own test subscriptions never consume a real founding
 * spot or inflate the "spots taken" number shown to real prospects. */
export async function countFoundingMembers(): Promise<number> {
  if (!isAdminConfigured()) return 0;
  try {
    const admin = createAdminSupabase();

    // Companies owned by a registered test account — their subscriptions don't count.
    const { data: testUsers } = await admin
      .from("test_accounts")
      .select("user_id")
      .not("user_id", "is", null);
    const testUserIds = (testUsers ?? []).map((r) => (r as { user_id: string }).user_id);

    let testCompanyIds: string[] = [];
    if (testUserIds.length > 0) {
      const { data: testCompanies } = await admin
        .from("companies")
        .select("id")
        .in("owner_user_id", testUserIds);
      testCompanyIds = (testCompanies ?? []).map((r) => (r as { id: string }).id);
    }

    let query = admin
      .from("subscriptions")
      .select("company_id", { count: "exact", head: true })
      .in("status", COUNTED_STATUSES);
    if (testCompanyIds.length > 0) {
      query = query.not("company_id", "in", `(${testCompanyIds.join(",")})`);
    }

    const { count } = await query;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** The tier a brand-new subscriber would land in right now. */
export async function currentFoundingTier(): Promise<FoundingTier> {
  return foundingTierFor(await countFoundingMembers());
}

/**
 * Retrieve-or-create the lifetime "%-off forever" coupon for a tier. Uses a stable
 * coupon id so we reuse one coupon per percentage and stay idempotent across races.
 */
export async function ensureFoundingCoupon(percent: number): Promise<string> {
  const stripe = getStripe();
  const id = `founding-${percent}-life`;
  try {
    const existing = await stripe.coupons.retrieve(id);
    if (existing && !existing.deleted) return existing.id;
  } catch {
    // Not found — fall through and create it.
  }
  try {
    const coupon = await stripe.coupons.create({
      id,
      percent_off: percent,
      duration: "forever",
      name: `Founding member — ${percent}% off for life`,
    });
    return coupon.id;
  } catch {
    // Almost certainly a create race (another checkout made it first). The id is
    // deterministic, so it's safe to use regardless.
    return id;
  }
}
