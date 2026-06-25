// Server-side Stripe wrapper. Test mode by default — flipping to live is just
// swapping STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET. Keys never reach the client.
import Stripe from "stripe";

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe is not configured");
  }
  _stripe ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

// Plans reference real Stripe price IDs so the Customer Portal can offer
// plan switching. Run `node scripts/create-stripe-products.mjs` once to
// create the products and get the IDs, then add them to .env.local.
export const PLANS = {
  starter: {
    key: "starter",
    name: "ShieldFlow Starter",
    amount: 24900, // used as fallback if price ID is missing
    description: "Up to 2 frameworks, evidence vault, AI policies & co-pilot.",
    priceId: process.env.STRIPE_PRICE_STARTER ?? null,
  },
  growth: {
    key: "growth",
    name: "ShieldFlow Growth",
    amount: 59900,
    description: "Everything in Starter plus integrations, vendor risk, Trust Center.",
    priceId: process.env.STRIPE_PRICE_GROWTH ?? null,
  },
} as const;

export type PlanKey = keyof typeof PLANS;
