import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, getCallerAccess } from "@/lib/db/queries";
import { reconcileCheckout, reconcilePortalReturn } from "@/lib/billing-sync";

// Billing now lives at Settings → Billing (?tab=billing) — competitors (Vanta,
// Drata, Secureframe, Notion, Linear) all fold billing into Settings rather
// than giving it a top-level nav slot. This route stays for two reasons:
// Stripe checkout/portal return URLs point here, and old links/bookmarks.
// It reconciles the Stripe state, then forwards to the Settings tab.
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
  // change plans (this is the server-side gate; the Settings tab hides it too).
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

  // Forward only the values we generate ourselves (success/cancelled) — the
  // Billing tab's PlanCards shows its success note off this param.
  const status = params.status === "success" || params.status === "cancelled" ? params.status : null;
  redirect(status ? `/settings?tab=billing&status=${status}` : "/settings?tab=billing");
}
