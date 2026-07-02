import { redirect } from "next/navigation";
import Link from "next/link";
import { FileText, FolderArchive } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  getControlsWithStatus,
  listAllEvidence,
} from "@/lib/db/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListCard, ListRow } from "@/components/ui/ListCard";
import { timeAgo, formatDateTime, dateGroupLabel } from "@/lib/format";
import type { Evidence } from "@/lib/db/queries";

export default async function EvidencePage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [evidence, controls] = await Promise.all([
    listAllEvidence(supabase, company.id),
    getControlsWithStatus(supabase, company.id),
  ]);
  const controlById = new Map(controls.map((c) => [c.id, c]));

  // Newest-first rows arrive with same-day entries consecutive — group them
  // under a date header (Today / Yesterday / …), same pattern as the Activity log.
  const groups: { label: string; items: Evidence[] }[] = [];
  for (const ev of evidence) {
    const label = dateGroupLabel(ev.created_at);
    const current = groups[groups.length - 1];
    if (current && current.label === label) current.items.push(ev);
    else groups.push({ label, items: [ev] });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Evidence vault"
        subtitle="All evidence collected across your controls. Upload from any control page."
      />

      {evidence.length === 0 ? (
        <EmptyState
          icon={<FolderArchive className="h-6 w-6" />}
          title="No evidence yet"
          description="Open a control and upload your first file — everything collected lands here."
        />
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </div>
              <ListCard>
                {group.items.map((ev) => {
                  const c = ev.control_id ? controlById.get(ev.control_id) : null;
                  return (
                    <ListRow key={ev.id}>
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="shrink-0 rounded-full bg-secondary p-1.5 text-muted-foreground">
                          <FileText className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {ev.file_name}
                          </div>
                          {c && (
                            <div className="text-xs text-muted-foreground">
                              linked to {c.code} · {c.title}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {c && (
                          <Link
                            href={`/controls/${c.id}`}
                            className="text-xs text-foreground underline hover:text-muted-foreground"
                          >
                            View control
                          </Link>
                        )}
                        <time
                          dateTime={ev.created_at}
                          title={formatDateTime(ev.created_at)}
                          className="whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground"
                        >
                          {timeAgo(ev.created_at)}
                        </time>
                      </div>
                    </ListRow>
                  );
                })}
              </ListCard>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
