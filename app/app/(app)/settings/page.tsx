import { redirect } from "next/navigation";
import { KeyRound, Clock } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  getCallerAccess,
  getCompanyTeam,
  getSubscription,
  listNotificationPrefs,
  listSubprocessors,
  listTrustAccessRequests,
} from "@/lib/db/queries";
import { isStripeConfigured } from "@/lib/stripe";
import { currentFoundingTier } from "@/lib/founding-server";
import { TrustSettings } from "@/components/settings/TrustSettings";
import { TeamSettings } from "@/components/settings/TeamSettings";
import { NotificationPrefs } from "@/components/notifications/NotificationPrefs";
import { SubprocessorManager } from "@/components/settings/SubprocessorManager";
import { TrustRequests } from "@/components/settings/TrustRequests";
import { PlanCards } from "@/components/billing/PlanCards";
import { FilterChips } from "@/components/ui/FilterChips";
import { Badge } from "@/components/ui/Badge";
import { PageShell, Alert } from "@/components/ui/page";

// Settings is tabbed (the Vanta/Drata/Notion pattern: one Settings surface,
// sections inside) instead of a single long stack. Billing lives here too —
// competitors don't give it its own top-level nav slot. Tabs are role-gated
// server-side: the chip row hides what you can't use, and a hand-typed
// ?tab= for a forbidden section falls back to the default tab.
const TABS = [
  { key: "team", label: "Team" },
  { key: "notifications", label: "Notifications" },
  { key: "trust", label: "Trust Center", ownerOnly: true },
  { key: "sso", label: "Single sign-on", ownerOnly: true },
  { key: "billing", label: "Billing", ownerAdminOnly: true },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; status?: string }>;
}) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const access = await getCallerAccess(supabase, company.id, user.id);
  const isAuditor = access?.role === "auditor";
  const isOwner = company.owner_user_id === user.id;
  const canManageBilling = access?.role === "owner" || access?.role === "admin";

  const visibleTabs = TABS.filter((t) => {
    if ("ownerOnly" in t && t.ownerOnly && !isOwner) return false;
    if ("ownerAdminOnly" in t && t.ownerAdminOnly && !canManageBilling) return false;
    return true;
  });

  const params = await searchParams;
  const requested = params.tab as TabKey | undefined;
  const tab: TabKey = visibleTabs.some((t) => t.key === requested) ? requested! : "team";

  return (
    <PageShell layout="stack" title="Settings" subtitle={`Workspace settings for ${company.name}.`}>
      <FilterChips
        activeValue={tab}
        items={visibleTabs.map((t) => ({
          label: t.label,
          value: t.key,
          href: `/settings?tab=${t.key}`,
        }))}
      />

      {tab === "team" && <TeamTab supabase={supabase} companyId={company.id} ownerUserId={company.owner_user_id} currentUserId={user.id} isOwner={isOwner} />}
      {tab === "notifications" && <NotificationsTab supabase={supabase} userId={user.id} companyId={company.id} readOnly={isAuditor} />}
      {tab === "trust" && isOwner && <TrustTab supabase={supabase} companyId={company.id} companyName={company.name} />}
      {tab === "sso" && isOwner && <SsoTab />}
      {tab === "billing" && canManageBilling && <BillingTab supabase={supabase} companyId={company.id} />}
    </PageShell>
  );
}

// Each tab fetches only its own data — switching tabs shouldn't pay for all five.
type Supa = Awaited<ReturnType<typeof createServerSupabase>>;

async function TeamTab({
  supabase,
  companyId,
  ownerUserId,
  currentUserId,
  isOwner,
}: {
  supabase: Supa;
  companyId: string;
  ownerUserId: string;
  currentUserId: string;
  isOwner: boolean;
}) {
  const team = await getCompanyTeam(supabase, companyId).catch(() => ({ members: [], invites: [] }));
  return (
    <TeamSettings
      isOwner={isOwner}
      ownerUserId={ownerUserId}
      currentUserId={currentUserId}
      members={team.members}
      invites={team.invites}
    />
  );
}

async function NotificationsTab({
  supabase,
  userId,
  companyId,
  readOnly,
}: {
  supabase: Supa;
  userId: string;
  companyId: string;
  readOnly: boolean;
}) {
  const prefs = await listNotificationPrefs(supabase, userId, companyId).catch(() => []);
  return <NotificationPrefs prefs={prefs} readOnly={readOnly} />;
}

async function TrustTab({
  supabase,
  companyId,
  companyName,
}: {
  supabase: Supa;
  companyId: string;
  companyName: string;
}) {
  // trust columns aren't in the Company interface — fetch them directly.
  const { data } = await supabase
    .from("companies")
    .select("trust_slug, trust_enabled")
    .eq("id", companyId)
    .maybeSingle();
  const subprocessors = await listSubprocessors(supabase, companyId).catch(() => []);
  const trustRequests = await listTrustAccessRequests(supabase, companyId).catch(() => []);
  return (
    <>
      <TrustSettings
        companyName={companyName}
        initialSlug={(data?.trust_slug as string | null) ?? ""}
        initialEnabled={Boolean(data?.trust_enabled)}
      />
      <SubprocessorManager subprocessors={subprocessors} />
      <TrustRequests requests={trustRequests} />
    </>
  );
}

// Live SsoSettings/company_sso_domains/actions/sso.ts are all still in the
// codebase, untouched — SAML SSO needs a Supabase Pro plan we're not on yet
// (see docs/SSO_SCIM_PLAN.md), so this tab is gated to "coming soon" until
// that upgrade happens, rather than exposing a form that can't complete a
// real login round-trip.
function SsoTab() {
  return (
    <div className="card space-y-2 opacity-70">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Single sign-on (SSO)</h2>
        </div>
        <Badge variant="neutral" icon={<Clock className="h-3.5 w-3.5" />}>Coming soon</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Let your team sign in with your company&apos;s identity provider (Okta, Azure AD, Google
        Workspace) instead of a separate password. Available on the Custom plan — reach out and
        we&apos;ll get it set up for you.
      </p>
    </div>
  );
}

async function BillingTab({ supabase, companyId }: { supabase: Supa; companyId: string }) {
  const subscription = await getSubscription(supabase, companyId).catch(() => null);
  // Only pitch the founding discount to companies that haven't subscribed yet —
  // existing members already locked in their lifetime rate.
  const founding = subscription ? null : await currentFoundingTier().catch(() => null);
  return (
    <>
      {!isStripeConfigured() && (
        <Alert variant="warning">
          Billing isn&apos;t configured yet — add Stripe test keys to enable checkout. The rest of
          the app works normally.
        </Alert>
      )}
      <PlanCards
        currentPlan={subscription?.plan ?? null}
        subscriptionStatus={subscription?.status ?? null}
        stripeEnabled={isStripeConfigured()}
        founding={founding}
      />
    </>
  );
}
