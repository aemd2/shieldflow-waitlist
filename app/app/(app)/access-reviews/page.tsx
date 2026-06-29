import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  listAccessReviews,
  listAccessReviewItems,
  getCallerAccess,
} from "@/lib/db/queries";
import { AccessReviewWorkspace } from "@/components/access/AccessReviewWorkspace";

export default async function AccessReviewsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [reviews, items, access] = await Promise.all([
    listAccessReviews(supabase, company.id),
    listAccessReviewItems(supabase, company.id),
    getCallerAccess(supabase, company.id, user.id),
  ]);
  const canWrite = access?.canWrite ?? false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Access reviews</h1>
        <p className="text-sm text-muted-foreground">
          Periodically attest who should keep access. Snapshot the people and their access, mark
          keep or revoke on each, and completing the review files a signed evidence record. We record
          the attestation — we never revoke access for you.
        </p>
      </div>
      <AccessReviewWorkspace reviews={reviews} items={items} canWrite={canWrite} />
    </div>
  );
}
