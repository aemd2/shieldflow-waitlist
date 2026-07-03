import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  listRisks,
  getCallerAccess,
  getControlsWithStatus,
  listRiskControlLinks,
} from "@/lib/db/queries";
import { RiskManager } from "@/components/risks/RiskManager";
import { PageShell } from "@/components/ui/page";

export default async function RisksPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [risks, access, controls, links] = await Promise.all([
    listRisks(supabase, company.id),
    getCallerAccess(supabase, company.id, user.id),
    getControlsWithStatus(supabase, company.id),
    listRiskControlLinks(supabase, company.id),
  ]);
  const canWrite = access?.canWrite ?? false;
  const controlOptions = controls.map((c) => ({ id: c.id, code: c.code, title: c.title }));

  return (
    <PageShell
      layout="manager"
      title="Risk register"
      subtitle="Track your organisation's risks — likelihood, impact, and how you're treating them. High-impact risks surface on the dashboard."
    >
      <RiskManager risks={risks} canWrite={canWrite} controls={controlOptions} links={links} />
    </PageShell>
  );
}
