import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, listAuditEvents } from "@/lib/db/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

// Server-rendered filter chips → the `target_type` each one narrows to.
const FILTERS: { label: string; type?: string }[] = [
  { label: "All" },
  { label: "Controls", type: "control" },
  { label: "Evidence", type: "evidence" },
  { label: "Policies", type: "policy" },
  { label: "Vendors", type: "vendor" },
  { label: "Risks", type: "risk" },
  { label: "Training", type: "training" },
  { label: "Team", type: "member" },
  { label: "Integrations", type: "integration" },
];

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const { type } = await searchParams;
  const activeType = FILTERS.some((f) => f.type === type) ? type : undefined;

  const events = await listAuditEvents(supabase, company.id, { targetType: activeType });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity log"
        subtitle="Every change in your workspace — who did it and when. Append-only and tamper-evident."
      />

      <nav className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const isActive = f.type === activeType;
          const href = f.type ? `/activity?type=${f.type}` : "/activity";
          return (
            <Link
              key={f.label}
              href={href}
              className={cn(
                "rounded-full px-3 py-1 text-sm transition-colors",
                isActive
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      <ActivityFeed events={events} />
    </div>
  );
}
