import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { createAdminSupabase, isAdminConfigured } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Stripe webhook — no user session, so writes go through the service-role
// client (the subscriptions table deliberately has no authenticated write
// policies). Always 200 for events we understand-but-ignore, so Stripe stops
// retrying; 400 only for bad signatures / misconfiguration.
export async function POST(req: Request) {
  if (!isStripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET || !isAdminConfigured()) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 400 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });

  let event: Stripe.Event;
  try {
    const rawBody = await req.text();
    event = getStripe().webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const admin = createAdminSupabase();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const companyId = session.metadata?.company_id;
        const plan = session.metadata?.plan;
        if (!companyId || (plan !== "starter" && plan !== "growth")) break; // ack & ignore
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
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const companyId = sub.metadata?.company_id;
        if (!companyId) break;
        const periodEnd = sub.items?.data?.[0]?.current_period_end;
        await admin
          .from("subscriptions")
          .update({
            status: sub.status,
            current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
            updated_at: new Date().toISOString(),
          })
          .eq("company_id", companyId);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const companyId = sub.metadata?.company_id;
        if (!companyId) break;
        await admin.from("subscriptions").delete().eq("company_id", companyId);
        break;
      }

      default:
        // Unknown/unneeded event — acknowledge so Stripe doesn't retry.
        break;
    }
  } catch {
    // DB hiccup: tell Stripe to retry later.
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
