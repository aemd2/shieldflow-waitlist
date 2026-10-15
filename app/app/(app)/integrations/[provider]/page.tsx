import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabase, getRequestUser } from "@/lib/supabase/server";
import { getCompanyForUser, getCallerAccess } from "@/lib/db/queries";
import { PROVIDER_BY_KEY } from "@/lib/integrations/registry";
import { loadProviderView } from "@/lib/integrations/provider-view";
import { PageShell } from "@/components/ui/page";
import { ProviderWorkspace } from "@/components/integrations/ProviderWorkspace";

// A scan runs inside a server action invoked from this page: give it room.
export const maxDuration = 60;

export default async function ProviderPage({ params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const entry = PROVIDER_BY_KEY.get(provider);
  if (!entry) notFound();

  const supabase = await createServerSupabase();
  const user = await getRequestUser();
  if (!user) redirect("/login");
  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [view, access] = await Promise.all([loadProviderView(supabase, company.id, entry), getCallerAccess(supabase, company.id, user.id)]);

  return (
    <PageShell
      title={entry.title}
      subtitle={entry.subtitle}
      actions={
        <Link href={`/checks/${entry.key}`} className="text-xs text-muted-foreground underline">
          What we check, and what we never read
        </Link>
      }
    >
      <ProviderWorkspace
        view={view}
        title={entry.title}
        catalog={entry.checks}
        areas={entry.areas}
        settingFields={entry.settings ?? []}
        canWrite={access?.canWrite ?? false}
      />
    </PageShell>
  );
}
