import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  getCallerAccess,
  getCompanyTeam,
  listNotificationPrefs,
  listSubprocessors,
  listTrustAccessRequests,
  listSsoDomains,
} from "@/lib/db/queries";
import { TrustSettings } from "@/components/settings/TrustSettings";
import { TeamSettings } from "@/components/settings/TeamSettings";
import { NotificationPrefs } from "@/components/notifications/NotificationPrefs";
import { SubprocessorManager } from "@/components/settings/SubprocessorManager";
import { TrustRequests } from "@/components/settings/TrustRequests";
import { SsoSettings } from "@/components/settings/SsoSettings";
import { PageShell } from "@/components/ui/page";

export default async function SettingsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  // trust columns aren't in the Company interface — fetch them directly.
  const { data } = await supabase
    .from("companies")
    .select("trust_slug, trust_enabled")
    .eq("id", company.id)
    .maybeSingle();

  const team = await getCompanyTeam(supabase, company.id).catch(() => ({
    members: [],
    invites: [],
  }));
  const notificationPrefs = await listNotificationPrefs(supabase, user.id, company.id).catch(() => []);
  const access = await getCallerAccess(supabase, company.id, user.id);
  const isAuditor = access?.role === "auditor";
  const isOwner = company.owner_user_id === user.id;
  const subprocessors = isOwner ? await listSubprocessors(supabase, company.id).catch(() => []) : [];
  const trustRequests = isOwner ? await listTrustAccessRequests(supabase, company.id).catch(() => []) : [];
  const ssoDomains = isOwner ? await listSsoDomains(supabase, company.id).catch(() => []) : [];

  return (
    <PageShell layout="stack" title="Settings" subtitle={`Workspace settings for ${company.name}.`}>
      <TeamSettings
        isOwner={isOwner}
        ownerUserId={company.owner_user_id}
        currentUserId={user.id}
        members={team.members}
        invites={team.invites}
      />

      <NotificationPrefs prefs={notificationPrefs} readOnly={isAuditor} />

      {/* Trust Center is an owner-only workspace setting (RLS enforces it too). */}
      {isOwner && (
        <>
          <TrustSettings
            companyName={company.name}
            initialSlug={(data?.trust_slug as string | null) ?? ""}
            initialEnabled={Boolean(data?.trust_enabled)}
          />
          <SubprocessorManager subprocessors={subprocessors} />
          <TrustRequests requests={trustRequests} />
          <SsoSettings domains={ssoDomains} />
        </>
      )}
    </PageShell>
  );
}
