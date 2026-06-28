import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, listFrameworks } from "@/lib/db/queries";
import { OnboardingForm } from "@/components/onboarding/OnboardingForm";

export default async function OnboardingPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const existing = await getCompanyForUser(supabase, user.id);
  if (existing) redirect("/dashboard");

  // SSO just-in-time: if this user's verified email domain maps to a company with
  // SSO enabled, auto-join it instead of forcing onboarding. Returns null for
  // normal signups (no matching verified domain), so they see the form as usual.
  const { data: joinedCompanyId } = await supabase.rpc("join_company_via_sso");
  if (joinedCompanyId) redirect("/dashboard");

  const frameworks = await listFrameworks(supabase);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">Welcome to ShieldFlow</h1>
      <p className="mb-8 text-muted-foreground">
        Let's set up your workspace. This takes less than a minute.
      </p>
      <OnboardingForm frameworks={frameworks} />
    </div>
  );
}
