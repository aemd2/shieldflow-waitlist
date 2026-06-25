import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, listRisks, getCallerAccess } from "@/lib/db/queries";
import { RiskManager } from "@/components/risks/RiskManager";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function RisksPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [risks, access] = await Promise.all([
    listRisks(supabase, company.id),
    getCallerAccess(supabase, company.id, user.id),
  ]);
  const canWrite = access?.canWrite ?? false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk register"
        subtitle="Track your organisation's risks — likelihood, impact, and how you're treating them. High-impact risks surface on the dashboard."
      />

      <RiskManager risks={risks} canWrite={canWrite} />
    </div>
  );
}
