import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, listFrameworks } from "@/lib/db/queries";
import { lookupTrialInvite } from "@/lib/trial-server";
import { OnboardingForm } from "@/components/onboarding/OnboardingForm";
import { PageShell } from "@/components/ui/page";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ trial?: string }>;
}) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const existing = await getCompanyForUser(supabase, user.id);
  if (existing) redirect("/dashboard");

  const { data: joinedCompanyId } = await supabase.rpc("join_company_via_sso");
  if (joinedCompanyId) redirect("/dashboard");

  // A Tester invite can land here two ways: straight off /trial/[code], or via
  // signup carrying `next`. Re-validate rather than trusting the query string —
  // an invalid code just means a normal (Free) signup, never a broken one.
  const { trial } = await searchParams;
  const invite = trial ? await lookupTrialInvite(trial) : null;
  const trialCode = invite?.status === "valid" ? invite.code : null;
  const trialDays = invite?.status === "valid" ? invite.days : 0;

  const frameworks = await listFrameworks(supabase);

  return (
    <PageShell
      layout="stack"
      width="compact"
      title="Welcome to ShieldFlow"
      subtitle="Let's set up your workspace. This takes less than a minute."
    >
      {trialCode && (
        <div className="card flex items-start gap-3 border-[var(--brand-emerald)]/45 bg-[var(--brand-emerald)]/[0.07]">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-[var(--brand-emerald)]" />
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              Your {trialDays}-day full-access trial is ready.
            </span>{" "}
            It starts the moment your workspace is created — no card needed.
          </p>
        </div>
      )}

      <OnboardingForm frameworks={frameworks} trialCode={trialCode} />
    </PageShell>
  );
}
