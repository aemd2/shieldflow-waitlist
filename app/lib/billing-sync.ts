// Fallback sync for two scenarios where webhooks haven't fired (typical locally):
//  1. reconcileCheckout — user returns from a new checkout (has session_id)
//  2. reconcilePortalReturn — user returns from the Customer Portal after
//     upgrading/downgrading (no session_id — we fetch the live sub from Stripe)
// Both are idempotent: if the webhook already wrote the row, they converge to
// the same state.
import "server-only";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { createAdminSupabase, isAdminConfigured } from "@/lib/supabase/admin";

/** Sync after a Customer Portal return (upgrade / downgrade / cancel). */
export async function reconcilePortalReturn(companyId: string): Promise<void> {
  if (!isStripeConfigured() || !isAdminConfigured()) return;

  try {
    const admin = createAdminSupabase();

    // Get the stored customer ID + subscription ID for this company.
    const { data: row } = await admin
      .from("subscriptions")
      .select("stripe_customer_id, stripe_subscription_id")
      .eq("company_id", companyId)
      .maybeSingle();

    if (!row?.stripe_subscription_id) return;

    // Fetch the live subscription from Stripe.
    const sub = await getStripe().subscriptions.retrieve(row.stripe_subscription_id, {
      expand: ["items.data.price.product"],
    });

    // Derive the plan key from the product name stored in Stripe.
    const productName =
      (sub.items.data[0]?.price?.product as { name?: string } | null)?.name?.toLowerCase() ?? "";
    const plan = productName.includes("growth") ? "growth" : "starter";

    await admin.from("subscriptions").upsert(
      {
        company_id: companyId,
        stripe_customer_id: row.stripe_customer_id,
        stripe_subscription_id: sub.id,
        plan,
        status: sub.status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id" },
    );
  } catch {
    // Best-effort: webhook remains the source of truth in production.
  }
}

export async function reconcileCheckout(sessionId: string, companyId: string): Promise<void> {
  if (!isStripeConfigured() || !isAdminConfigured()) return;
  // Stripe checkout session ids are cs_..., bounded length — reject junk early.
  if (!/^cs_[a-zA-Z0-9_]{10,200}$/.test(sessionId)) return;

  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);

    // Trust nothing from the URL: the session must belong to THIS company
    // (metadata was set server-side at creation) and must actually be paid.
    if (session.metadata?.company_id !== companyId) return;
    if (session.payment_status !== "paid" && session.status !== "complete") return;
    const plan = session.metadata?.plan;
    if (plan !== "starter" && plan !== "growth") return;

    const admin = createAdminSupabase();
    await admin.from("subscriptions").upsert(
      {
        company_id: companyId,
        stripe_customer_id: typeof session.customer === "string" ? session.customer : null,
        stripe_subscription_id:
          typeof session.subscription === "string" ? session.subscription : null,
        plan,
        status: "active",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id" },
    );
  } catch {
    // Best-effort: the webhook remains the source of truth.
  }
}
