import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, getCallerAccess, getMeasuresWithStatus } from "@/lib/db/queries";
import { MeasureManager } from "@/components/measures/MeasureManager";
import { PageShell } from "@/components/ui/page";

export default async function MeasuresPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [measures, access] = await Promise.all([
    getMeasuresWithStatus(supabase, company.id),
    getCallerAccess(supabase, company.id, user.id),
  ]);

  return (
    <PageShell
      layout="manager"
      title="Measures"
      subtitle="The things you actually do. Each one satisfies requirements in one or more frameworks, so the work — and the evidence — happens once instead of once per framework."
    >
      <MeasureManager measures={measures} canWrite={access?.canWrite ?? false} />
    </PageShell>
  );
}
