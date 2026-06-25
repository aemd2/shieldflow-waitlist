import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, listTraining, getCallerAccess } from "@/lib/db/queries";
import { TrainingManager } from "@/components/training/TrainingManager";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function TrainingPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [records, access] = await Promise.all([
    listTraining(supabase, company.id),
    getCallerAccess(supabase, company.id, user.id),
  ]);
  const canWrite = access?.canWrite ?? false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employee training"
        subtitle="Track security-awareness training completion across your team. Overdue assignments surface on the dashboard."
      />

      <TrainingManager records={records} canWrite={canWrite} />
    </div>
  );
}
