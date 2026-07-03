import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, getSubscription, getCallerAccess } from "@/lib/db/queries";
import { isStripeConfigured } from "@/lib/stripe";
import { reconcileCheckout, reconcilePortalReturn } from "@/lib/billing-sync";
import { currentFoundingTier } from "@/lib/founding-server";
import { PlanCards } from "@/components/billing/PlanCards";
import { PageShell, Alert } from "@/components/ui/page";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; session_id?: string; portal?: string }>;
}) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  // Billing is an owner/admin surface only — members and auditors can't see or
  // change plans (the nav hides it for them too; this is the server-side gate).
  const access = await getCallerAccess(supabase, company.id, user.id);
  if (access?.role !== "owner" && access?.role !== "admin") redirect("/dashboard");

  // Sync with Stripe on return from checkout or portal — handles the case where
  // webhooks haven't fired yet (always the case locally without `stripe listen`).
  const params = await searchParams;
  if (params.status === "success" && params.session_id) {
    // New checkout: sync via session ID.
    await reconcileCheckout(params.session_id, company.id);
  } else if (params.portal === "1") {
    // Portal return (upgrade / downgrade / cancel): sync live subscription.
    await reconcilePortalReturn(company.id);
  }

  const subscription = await getSubscription(supabase, company.id).catch(() => null);
  // Only pitch the founding discount to companies that haven't subscribed yet —
  // existing members already locked in their lifetime rate.
  const founding = subscription ? null : await currentFoundingTier().catch(() => null);

  return (
    <PageShell
      layout="stack"
      title="Billing"
      subtitle={`Plans for ${company.name}. Cancel anytime from the billing portal.`}
      alert={
        !isStripeConfigured() ? (
          <Alert variant="warning">
            Billing isn&apos;t configured yet — add Stripe test keys to enable checkout. The rest
            of the app works normally.
          </Alert>
        ) : undefined
      }
    >
      <PlanCards
        currentPlan={subscription?.plan ?? null}
        subscriptionStatus={subscription?.status ?? null}
        stripeEnabled={isStripeConfigured()}
        founding={founding}
      />
    </PageShell>
  );
}
