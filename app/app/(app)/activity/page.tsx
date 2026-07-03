import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser, listAuditEvents } from "@/lib/db/queries";
import { PageShell, FilterChips } from "@/components/ui/page";
import { buttonClasses } from "@/components/ui/Button";
import { ActivityFeed } from "@/components/activity/ActivityFeed";

const PAGE_SIZE = 20;

export const dynamic = "force-dynamic";

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
  searchParams: Promise<{ type?: string; page?: string }>;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const { type, page: pageParam } = await searchParams;
  const activeType = FILTERS.some((f) => f.type === type) ? type : undefined;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const { events, hasMore } = await listAuditEvents(supabase, company.id, {
    targetType: activeType,
    page,
    pageSize: PAGE_SIZE,
  });

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (activeType) params.set("type", activeType);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/activity?${qs}` : "/activity";
  };

  const filterChips = FILTERS.map((f) => ({
    label: f.label,
    value: f.type,
    href: f.type ? `/activity?type=${f.type}` : "/activity",
  }));

  const pagination =
    page > 1 || hasMore ? (
      <div className="flex items-center justify-between">
        {page > 1 ? (
          <Link href={pageHref(page - 1)} className={buttonClasses("outline", "sm")}>
            <ChevronLeft className="mr-1 h-3 w-3" /> Newer
          </Link>
        ) : (
          <span />
        )}
        <span className="text-xs text-muted-foreground">Page {page}</span>
        {hasMore ? (
          <Link href={pageHref(page + 1)} className={buttonClasses("outline", "sm")}>
            Older <ChevronRight className="ml-1 h-3 w-3" />
          </Link>
        ) : (
          <span />
        )}
      </div>
    ) : undefined;

  return (
    <PageShell
      layout="feed"
      title="Activity log"
      subtitle="Every change in your workspace — who did it and when. Append-only and tamper-evident."
      toolbar={<FilterChips items={filterChips} activeValue={activeType} />}
      footer={pagination}
    >
      <ActivityFeed events={events} />
    </PageShell>
  );
}
