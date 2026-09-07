import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  listPersonnel,
  listTraining,
  getCallerAccess,
  listIntegrations,
  getUnmatchedAccounts,
} from "@/lib/db/queries";
import { PersonnelManager } from "@/components/personnel/PersonnelManager";
import { UnmatchedAccounts } from "@/components/personnel/UnmatchedAccounts";
import type { RosterProviderInfo } from "@/app/actions/access-reviews";
import { PageShell } from "@/components/ui/page";

const ROSTER_LABELS: Record<string, string> = {
  okta: "Okta",
  google_workspace: "Google Workspace",
};

export default async function PersonnelPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [people, training, access, integrations, unmatched] = await Promise.all([
    listPersonnel(supabase, company.id),
    listTraining(supabase, company.id),
    getCallerAccess(supabase, company.id, user.id),
    listIntegrations(supabase, company.id).catch(() => []),
    // Never let the reconciliation panel take the page down with it.
    getUnmatchedAccounts(supabase, company.id).catch(() => ({ emails: [], dismissed: [] })),
  ]);
  const canWrite = access?.canWrite ?? false;

  // Same identity-directory-only filter used on the access-reviews roster
  // picker — GitHub/AWS/etc. aren't "who works here" sources.
  const rosterProviders: RosterProviderInfo[] = integrations
    .filter((i) => i.status === "connected" && (i.provider === "okta" || i.provider === "google_workspace"))
    .map((i) => ({ provider: i.provider as "okta" | "google_workspace", label: ROSTER_LABELS[i.provider] }));

  return (
    <PageShell
      layout="manager"
      title="Personnel"
      subtitle="Who works here — joiners and leavers, roles, and security-training status (matched to training records by email). The roster auditors ask for."
    >
      <UnmatchedAccounts
        emails={unmatched.emails}
        dismissed={unmatched.dismissed}
        canWrite={canWrite}
      />
      <PersonnelManager
        people={people}
        training={training}
        canWrite={canWrite}
        rosterProviders={rosterProviders}
        currentUserEmail={user.email ?? ""}
      />
    </PageShell>
  );
}
