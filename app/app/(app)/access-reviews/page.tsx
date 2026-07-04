import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  listAccessReviews,
  listAccessReviewItems,
  getCallerAccess,
  listIntegrations,
} from "@/lib/db/queries";
import { AccessReviewWorkspace, type RosterProviderInfo } from "@/components/access/AccessReviewWorkspace";
import { PageShell } from "@/components/ui/page";

const ROSTER_LABELS: Record<string, string> = {
  okta: "Okta",
  google_workspace: "Google Workspace",
};

export default async function AccessReviewsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [reviews, items, access, integrations] = await Promise.all([
    listAccessReviews(supabase, company.id),
    listAccessReviewItems(supabase, company.id),
    getCallerAccess(supabase, company.id, user.id),
    listIntegrations(supabase, company.id).catch(() => []),
  ]);
  const canWrite = access?.canWrite ?? false;

  // Only identity-directory integrations can populate a roster (Okta, Google
  // Workspace) — GitHub/AWS/etc. are infra, not "who has access" sources.
  const rosterProviders: RosterProviderInfo[] = integrations
    .filter((i) => i.status === "connected" && (i.provider === "okta" || i.provider === "google_workspace"))
    .map((i) => ({ provider: i.provider as "okta" | "google_workspace", label: ROSTER_LABELS[i.provider] }));

  return (
    <PageShell
      layout="workspace"
      title="Access reviews"
      subtitle="Periodically attest who should keep access. Snapshot the people and their access, mark keep or revoke on each, and completing the review files a signed evidence record. We record the attestation — we never revoke access for you."
    >
      <AccessReviewWorkspace
        reviews={reviews}
        items={items}
        canWrite={canWrite}
        rosterProviders={rosterProviders}
        currentUserEmail={user.email ?? ""}
      />
    </PageShell>
  );
}
