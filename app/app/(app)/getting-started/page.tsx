import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  getControlsWithStatus,
  listPolicies,
  listIntegrations,
  type Integration,
} from "@/lib/db/queries";
import { computeSprint } from "@/lib/setup";
import { SprintGuide, type OutstandingControl } from "@/components/setup/SprintGuide";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function GettingStartedPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  // All company-scoped loaders — RLS confines them to this workspace. Read-only page,
  // so no write/RBAC surface (auditors can view their own sprint progress).
  const [controls, policies, integrations] = await Promise.all([
    getControlsWithStatus(supabase, company.id),
    listPolicies(supabase, company.id),
    listIntegrations(supabase, company.id).catch(() => [] as Integration[]),
  ]);

  const connectedIntegrations = integrations.filter((i) => i.status === "connected").length;
  const approvedPolicies = policies.filter((p) => p.status === "final").length;

  const sprint = computeSprint({ connectedIntegrations, controls, approvedPolicies });

  const outstandingCore: OutstandingControl[] = controls
    .filter((c) => c.criticality === "core" && c.status !== "complete")
    .map((c) => ({ id: c.id, code: c.code, title: c.title }));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <PageHeader
          title="Getting started"
          subtitle={`Your guided path to audit-ready for ${company.name}.`}
        />
      </div>
      <SprintGuide sprint={sprint} outstandingCore={outstandingCore} />
    </div>
  );
}
