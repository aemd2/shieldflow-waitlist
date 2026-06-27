"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, getSubscription, assertCanWrite } from "@/lib/db/queries";
import { getStripe, isStripeConfigured, PLANS, type PlanKey } from "@/lib/stripe";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { foundingTierFor } from "@/lib/founding";
import { countFoundingMembers, ensureFoundingCoupon } from "@/lib/founding-server";

const DB_ERROR = "We couldn't reach the database. Please try again in a moment.";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
}

/** Create a Stripe Checkout Session for a plan + interval; returns the redirect URL. */
export async function startCheckout(plan: string, interval: "month" | "year" = "month") {
  if (!isStripeConfigured()) return { error: "Billing isn't configured yet." };
  if (plan !== "starter" && plan !== "growth") return { error: "Unknown plan." };
  if (interval !== "month" && interval !== "year") return { error: "Unknown billing interval." };

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!checkRateLimit(`billing:${user.id}`, 5, 60_000)) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  let company;
  try {
    company = await getCompanyForUser(supabase, user.id);
  } catch {
    return { error: DB_ERROR };
  }
  if (!company) return { error: "No company found." };

  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { error: denied };

  // Double-subscribe guard: two tabs / double-click would otherwise create two
  // real Stripe subscriptions for the same company.
  try {
    const existing = await getSubscription(supabase, company.id);
    if (existing && existing.status !== "canceled") {
      return { error: "You already have a subscription — manage it from the billing portal." };
    }
  } catch {
    return { error: DB_ERROR };
  }

  const p = PLANS[plan as PlanKey];
  // Annual = 12× the monthly rate (per the PRD pricing table). The discount lever
  // is the founder promotion code, applied at checkout below.
  const unitAmount = interval === "year" ? p.amount * 12 : p.amount;

  // A saved monthly price ID enables portal plan-switching; otherwise (and always
  // for annual) build inline price_data so checkout works without extra setup.
  const lineItem =
    p.priceId && interval === "month"
      ? { price: p.priceId, quantity: 1 }
      : {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: unitAmount,
            recurring: { interval },
            product_data: {
              name: `${p.name} (${interval === "year" ? "annual" : "monthly"})`,
              description: p.description,
            },
          },
        };

  // Founding-cohort pricing: the tier the NEXT member lands in (100 → 80 → … → 0%),
  // resolved server-side so the client can't pick its own discount. We attach the
  // matching lifetime coupon (duration=forever) so the rate sticks for good.
  const tier = foundingTierFor(await countFoundingMembers());
  let discount: { discounts: [{ coupon: string }] } | { allow_promotion_codes: true } = {
    allow_promotion_codes: true,
  };
  if (tier.percent > 0) {
    try {
      discount = { discounts: [{ coupon: await ensureFoundingCoupon(tier.percent) }] };
    } catch {
      discount = { allow_promotion_codes: true };
    }
  }

  // company_id on BOTH the session and the subscription, so every webhook event
  // type can resolve which company it belongs to; founding_percent is kept for the record.
  const meta = { company_id: company.id, plan: p.key, founding_percent: String(tier.percent) };

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      customer_email: user.email ?? undefined,
      line_items: [lineItem],
      // 100%-off founders are never charged, so don't force a card; the paying
      // tiers (80% … 0%) still owe a balance, so Stripe collects one then.
      payment_method_collection: "if_required",
      ...discount,
      metadata: meta,
      subscription_data: { metadata: meta },
      // session_id lets the billing page reconcile directly with Stripe even if
      // the webhook never arrives (common locally without `stripe listen`).
      success_url: `${appUrl()}/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl()}/billing?status=cancelled`,
    });
    if (!session.url) return { error: "Could not start checkout. Please try again." };
    return { url: session.url };
  } catch {
    return { error: "Could not start checkout. Please try again." };
  }
}

/** Stripe Billing Portal for managing/cancelling an existing subscription. */
export async function openBillingPortal() {
  if (!isStripeConfigured()) return { error: "Billing isn't configured yet." };

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

  const denied = await assertCanWrite(supabase, company.id, user.id);
  if (denied) return { error: denied };

  let sub;
  try {
    sub = await getSubscription(supabase, company.id);
  } catch {
    return { error: DB_ERROR };
  }

  const { data: row } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("company_id", company.id)
    .maybeSingle();
  const customerId = row?.stripe_customer_id as string | undefined;
  if (!sub || !customerId) return { error: "No subscription to manage yet." };

  try {
    const portal = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      // portal=1 tells the billing page to re-sync the plan from Stripe on return
      // (handles upgrades/downgrades made inside the portal without webhooks).
      return_url: `${appUrl()}/billing?portal=1`,
    });
    return { url: portal.url };
  } catch {
    return { error: "Could not open the billing portal. Please try again." };
  }
}
