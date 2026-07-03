import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, listVendors, getCallerAccess } from "@/lib/db/queries";
import { VendorManager } from "@/components/vendors/VendorManager";
import { PageShell } from "@/components/ui/page";

export default async function VendorsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [vendors, access] = await Promise.all([
    listVendors(supabase, company.id),
    getCallerAccess(supabase, company.id, user.id),
  ]);
  const canWrite = access?.canWrite ?? false;

  return (
    <PageShell
      layout="manager"
      title="Vendor risk"
      subtitle="Track third-party vendors, their risk level, and review status."
    >
      <VendorManager vendors={vendors} canWrite={canWrite} />
    </PageShell>
  );
}
