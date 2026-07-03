import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  listPersonnel,
  listTraining,
  getCallerAccess,
} from "@/lib/db/queries";
import { PersonnelManager } from "@/components/personnel/PersonnelManager";
import { PageShell } from "@/components/ui/page";

export default async function PersonnelPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [people, training, access] = await Promise.all([
    listPersonnel(supabase, company.id),
    listTraining(supabase, company.id),
    getCallerAccess(supabase, company.id, user.id),
  ]);
  const canWrite = access?.canWrite ?? false;

  return (
    <PageShell
      layout="manager"
      title="Personnel"
      subtitle="Who works here — joiners and leavers, roles, and security-training status (matched to training records by email). The roster auditors ask for."
    >
      <PersonnelManager people={people} training={training} canWrite={canWrite} />
    </PageShell>
  );
}
