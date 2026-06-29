import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  listPersonnel,
  listTraining,
  getCallerAccess,
} from "@/lib/db/queries";
import { PersonnelManager } from "@/components/personnel/PersonnelManager";

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Personnel</h1>
        <p className="text-sm text-muted-foreground">
          Who works here — joiners and leavers, roles, and security-training status (matched to
          training records by email). The roster auditors ask for.
        </p>
      </div>
      <PersonnelManager people={people} training={training} canWrite={canWrite} />
    </div>
  );
}
