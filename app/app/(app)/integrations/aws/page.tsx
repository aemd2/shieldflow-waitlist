import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabase, getRequestUser } from "@/lib/supabase/server";
import { getCompanyForUser, getCallerAccess } from "@/lib/db/queries";
import { loadAwsView } from "@/lib/aws/view";
import { PageShell } from "@/components/ui/page";
import { AwsWorkspace } from "@/components/integrations/aws/AwsWorkspace";

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
      subtitle="Read-only checks across every account and region you use, who can reach production, changes made by hand, restore tests, and the facts you can tell customers. Anything we couldn't read says so instead of passing."
      actions={
        <Link href="/aws-checks" className="text-xs text-muted-foreground underline">
          What we check, and what we never read
        </Link>
      }
    >
      <AwsWorkspace view={view} canWrite={access?.canWrite ?? false} />
    </PageShell>
  );
}
