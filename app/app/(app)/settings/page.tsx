import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, getCompanyTeam } from "@/lib/db/queries";
import { TrustSettings } from "@/components/settings/TrustSettings";
import { TeamSettings } from "@/components/settings/TeamSettings";

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
  const isOwner = company.owner_user_id === user.id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Workspace settings for {company.name}.</p>
      </div>

      <TeamSettings
        isOwner={isOwner}
        ownerUserId={company.owner_user_id}
        currentUserId={user.id}
        members={team.members}
        invites={team.invites}
      />

      {/* Trust Center is an owner-only workspace setting (RLS enforces it too). */}
      {isOwner && (
        <TrustSettings
          companyName={company.name}
          initialSlug={(data?.trust_slug as string | null) ?? ""}
          initialEnabled={Boolean(data?.trust_enabled)}
        />
      )}
    </div>
  );
}
