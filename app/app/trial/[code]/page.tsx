import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck, Sparkles } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser } from "@/lib/db/queries";
import { getCompanyPlan } from "@/lib/plan-server";
import { lookupTrialInvite } from "@/lib/trial-server";
import { normalizeTrialCode } from "@/lib/trial";
import { buttonClasses } from "@/components/ui/Button";
import { TrialClaim } from "@/components/trial/TrialClaim";

export const dynamic = "force-dynamic";

// Invite links are private URLs — keep them out of search results entirely.
export const metadata = { robots: { index: false, follow: false } };

const PERKS = [
  "Every framework, control and evidence feature",
  "AI Co-Pilot and AI Policy Generator",
  "All integrations — AWS, GitHub, Google, Okta and more",
  "Vendor risk, access reviews and your public Trust Center",
];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary p-6">
      <div className="card w-full max-w-md space-y-4 text-center">{children}</div>
    </div>
  );
}

function Dead({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <h1 className="text-xl font-semibold text-foreground">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
      <Link href="/" className={`${buttonClasses("outline")} w-full`}>
        Go to ShieldFlow
      </Link>
    </Shell>
  );
}

export default async function TrialPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: rawCode } = await params;
  const code = normalizeTrialCode(rawCode);
  const invite = await lookupTrialInvite(code);

  if (invite.status === "unknown") {
    return (
      <Dead
        title="This trial link isn't valid"
        body="Double-check the link you were sent, or ask your ShieldFlow contact to send a fresh one."
      />
    );
  }
  if (invite.status === "expired") {
    return (
      <Dead
        title="This trial link has expired"
        body="Ask your ShieldFlow contact for a new link and you'll be up and running in a minute."
      />
    );
  }
  if (invite.status === "used") {
    return (
      <Dead
        title="This trial link has already been used"
        body="Each link works once. If that wasn't you, ask your ShieldFlow contact for a fresh one."
      />
    );
  }

  const { days } = invite;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  // Not signed in yet — pitch it, then hand off to signup carrying `next` so
  // they land back here (through email confirmation or Google) already authed.
  if (!user) {
    const next = encodeURIComponent(`/trial/${code}`);
    return (
      <Shell>
        <Sparkles className="mx-auto h-8 w-8 text-[var(--brand-emerald)]" />
        <h1 className="text-2xl font-semibold text-foreground">
          You&apos;ve been invited to try ShieldFlow
        </h1>
        <p className="text-sm text-muted-foreground">
          Your invitation unlocks <span className="font-medium text-foreground">every feature,
          free for {days} days</span>. No card needed. When the {days} days are up your workspace
          simply moves to the Free plan — you keep all your data.
        </p>

        <ul className="space-y-2 text-left">
          {PERKS.map((p) => (
            <li key={p} className="flex items-start gap-2 text-sm text-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-emerald)]" />
              {p}
            </li>
          ))}
        </ul>

        <Link href={`/signup?next=${next}`} className={`${buttonClasses("primary")} w-full`}>
          Start my {days}-day trial
        </Link>
        <p className="text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link href={`/login?next=${next}`} className="underline hover:text-foreground">
            Sign in
          </Link>{" "}
          and your trial starts straight away.
        </p>
      </Shell>
    );
  }

  // Signed in but no workspace yet — build it first; the onboarding form carries
  // the code through and redeems the moment the company exists.
  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect(`/onboarding?trial=${encodeURIComponent(code)}`);

  const plan = await getCompanyPlan(supabase, company.id);

  if (plan.plan === "starter" || plan.plan === "growth" || plan.plan === "custom") {
    return (
      <Dead
        title="You're already on a paid plan"
        body={`${company.name} is on ShieldFlow ${plan.plan}, which already includes everything in the trial. No need to redeem this link.`}
      />
    );
  }

  if (plan.trialActive) {
    return (
      <Dead
        title="Your trial is already running"
        body={`${company.name} has ${plan.daysLeft} day${plan.daysLeft === 1 ? "" : "s"} left of full access. Head to your dashboard and carry on.`}
      />
    );
  }

  if (plan.trialExpired) {
    return (
      <Dead
        title="This workspace has already had its trial"
        body={`${company.name} used its ${days}-day trial and is now on the Free plan. Upgrade from Billing to get the full feature set back.`}
      />
    );
  }

  return <TrialClaim code={code} days={days} email={user.email ?? ""} companyName={company.name} />;
}
