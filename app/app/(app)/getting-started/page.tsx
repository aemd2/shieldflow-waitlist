import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  getControlsWithStatus,
  getMeasuresWithStatus,
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

  const [controls, measures, policies, integrations] = await Promise.all([
    getControlsWithStatus(supabase, company.id),
    getMeasuresWithStatus(supabase, company.id).catch(() => []),
    listPolicies(supabase, company.id),
    listIntegrations(supabase, company.id).catch(() => [] as Integration[]),
  ]);

  const connectedIntegrations = integrations.filter((i) => i.status === "connected").length;
  const approvedPolicies = policies.filter((p) => p.status === "final").length;

  const sprint = computeSprint({ connectedIntegrations, controls, measures, approvedPolicies });

  // The "what's left" list under the current phase now names measures, matching
  // what the phase actually counts. Capped so a 64-item list doesn't bury the page.
  const outstandingCore: OutstandingControl[] = measures
    .filter((m) => m.importance === "mandatory" && m.status !== "complete")
    .slice(0, 8)
    .map((m) => ({ id: m.id, code: m.category, title: m.name }));

  return (
    <PageShell
      layout="stack"
      title="Getting started"
      subtitle={`Your guided path to Type I readiness for ${company.name}.`}
    >
      <SprintGuide sprint={sprint} outstandingCore={outstandingCore} />
    </PageShell>
  );
}
