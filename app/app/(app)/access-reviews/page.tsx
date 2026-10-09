import { redirect } from "next/navigation";
import { createServerSupabase, getRequestUser } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  listAccessReviews,
  listAccessReviewSystems,
  listAccessReviewItems,
  getCallerAccess,
  listIntegrations,
  listPersonnel,
} from "@/lib/db/queries";
import { AccessReviewWorkspace } from "@/components/access/AccessReviewWorkspace";
import type { RosterProviderInfo } from "@/app/actions/access-reviews";
import { PageShell } from "@/components/ui/page";

const ROSTER_LABELS: Record<string, string> = {
  okta: "Okta",
  google_workspace: "Google Workspace",
  microsoft: "Microsoft 365",
  aws: "AWS (production accounts)",
};

export default async function AccessReviewsPage() {
  const supabase = await createServerSupabase();
  const user = await getRequestUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [reviews, systems, items, access, integrations, personnel] = await Promise.all([
    listAccessReviews(supabase, company.id),
    listAccessReviewSystems(supabase, company.id),
    listAccessReviewItems(supabase, company.id),
    getCallerAccess(supabase, company.id, user.id),
    listIntegrations(supabase, company.id).catch(() => []),
    listPersonnel(supabase, company.id).catch(() => []),
  ]);
  const canWrite = access?.canWrite ?? false;

  // Autocomplete source for the roster "quick add" — the company's own HR
  // roster is the fastest way to fill a manual/custom system's accounts.
  const suggestions = personnel
    .filter((p) => p.email)
    .map((p) => ({ name: p.name, email: p.email as string, role: p.role_title }));

  // Directories (Okta, Google Workspace, Microsoft 365) and AWS, whose scan
  // reads who can reach production and with which permission set — the
  // population auditors sample for CC6.x.
  const rosterProviders: RosterProviderInfo[] = integrations
    .filter((i) => i.status === "connected" && i.provider in ROSTER_LABELS)
    .map((i) => ({ provider: i.provider as RosterProviderInfo["provider"], label: ROSTER_LABELS[i.provider] }));

  return (
    <PageShell
      layout="workspace"
      title="Access reviews"
      subtitle="Periodically attest who should keep access. Snapshot the people and their access, mark keep or revoke on each, and completing the review files a signed evidence record. We record the attestation — we never revoke access for you."
    >
      <AccessReviewWorkspace
        reviews={reviews}
        systems={systems}
        items={items}
        canWrite={canWrite}
        rosterProviders={rosterProviders}
        currentUserEmail={user.email ?? ""}
        personnelSuggestions={suggestions}
      />
    </PageShell>
  );
}
