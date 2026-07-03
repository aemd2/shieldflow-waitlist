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
import { PageShell } from "@/components/ui/page";

export default async function GettingStartedPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

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
    <PageShell
      layout="stack"
      width="narrow"
      title="Getting started"
      subtitle={`Your guided path to audit-ready for ${company.name}.`}
    >
      <SprintGuide sprint={sprint} outstandingCore={outstandingCore} />
    </PageShell>
  );
}
