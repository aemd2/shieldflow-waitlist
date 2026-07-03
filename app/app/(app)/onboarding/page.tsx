import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, listFrameworks } from "@/lib/db/queries";
import { OnboardingForm } from "@/components/onboarding/OnboardingForm";
import { PageShell } from "@/components/ui/page";

export default async function OnboardingPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const existing = await getCompanyForUser(supabase, user.id);
  if (existing) redirect("/dashboard");

  const { data: joinedCompanyId } = await supabase.rpc("join_company_via_sso");
  if (joinedCompanyId) redirect("/dashboard");

  const frameworks = await listFrameworks(supabase);

  return (
    <PageShell
      layout="stack"
      width="compact"
      title="Welcome to ShieldFlow"
      subtitle="Let's set up your workspace. This takes less than a minute."
    >
      <OnboardingForm frameworks={frameworks} />
    </PageShell>
  );
}
