import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabase, getRequestUser } from "@/lib/supabase/server";
import { getCompanyForUser, getCallerAccess } from "@/lib/db/queries";
import { loadAwsView } from "@/lib/aws/view";
import { PageShell } from "@/components/ui/page";
import { AwsPosture } from "@/components/integrations/aws/AwsPosture";

// A scan runs inside a server action invoked from this page: give it room.
export const maxDuration = 60;

export default async function AwsPage() {
  const supabase = await createServerSupabase();
  const user = await getRequestUser();
  if (!user) redirect("/login");
  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [view, access] = await Promise.all([
    loadAwsView(supabase, company.id),
    getCallerAccess(supabase, company.id, user.id),
  ]);

  return (
    <PageShell
      title="AWS"
      subtitle="Read-only checks across every account and region you use. Each failure names the resource and the fix; anything we couldn't read says so instead of passing."
      actions={
        <Link href="/aws-checks" className="text-xs text-muted-foreground underline">
          What we check, and what we never read
        </Link>
      }
    >
      <AwsPosture view={view} canWrite={access?.canWrite ?? false} />
    </PageShell>
  );
}
