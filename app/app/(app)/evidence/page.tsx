import { redirect } from "next/navigation";
import Link from "next/link";
import { FileText, FolderArchive } from "lucide-react";
import { createServerSupabase, getRequestUser } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  getControlsWithStatus,
  listAllEvidence,
} from "@/lib/db/queries";
import { PageShell, DateGroupedList } from "@/components/ui/page";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRow } from "@/components/ui/ListCard";
import { EvidenceDownloadButton } from "@/components/evidence/EvidenceDownloadButton";
import { timeAgo, formatDateTime, dateGroupLabel } from "@/lib/format";
import type { Evidence } from "@/lib/db/queries";

export default async function EvidencePage() {
  const supabase = await createServerSupabase();
  const user = await getRequestUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [evidence, controls] = await Promise.all([
    listAllEvidence(supabase, company.id),
    getControlsWithStatus(supabase, company.id),
  ]);
  const controlById = new Map(controls.map((c) => [c.id, c]));

  // Files attached to a measure: which measure, and how many of this company's
  // requirements it backs (only frameworks the company has switched on).
  const measureIds = [...new Set(evidence.map((e) => e.measure_id).filter((id): id is string => !!id))];
  const measureInfo = new Map<string, { name: string; covers: number }>();
  if (measureIds.length > 0) {
    const { data: ms } = await supabase
      .from("measures")
      .select("id, name, measure_controls(control_id)")
      .in("id", measureIds);
    for (const m of (ms ?? []) as { id: string; name: string; measure_controls: { control_id: string }[] }[]) {
      measureInfo.set(m.id, {
        name: m.name,
        covers: m.measure_controls.filter((l) => controlById.has(l.control_id)).length,
      });
    }
  }

  const groups: { label: string; items: Evidence[] }[] = [];
  for (const ev of evidence) {
    const label = dateGroupLabel(ev.created_at);
    const current = groups[groups.length - 1];
    if (current && current.label === label) current.items.push(ev);
    else groups.push({ label, items: [ev] });
  }

  return (
    <PageShell
      layout="feed"
      title="Evidence vault"
      subtitle="All evidence collected across your controls. Attach a file to a measure once and it counts for every requirement the measure covers."
    >
      {evidence.length === 0 ? (
        <EmptyState
          icon={<FolderArchive className="h-6 w-6" />}
          title="No evidence yet"
          description="Open a control and upload your first file — everything collected lands here."
        />
      ) : (
        <DateGroupedList
          groups={groups}
          renderItem={(ev) => {
            const c = ev.control_id ? controlById.get(ev.control_id) : null;
            const m = ev.measure_id ? measureInfo.get(ev.measure_id) : null;
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
                    {m && (
                      <div className="text-xs text-muted-foreground">
                        attached to “{m.name}” · counts for {m.covers}{" "}
                        {m.covers === 1 ? "requirement" : "requirements"}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {m && (
                    <Link
                      href="/measures"
                      className="text-xs text-foreground underline hover:text-muted-foreground"
                    >
                      View measure
                    </Link>
                  )}
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
                  <EvidenceDownloadButton evidenceId={ev.id} />
                </div>
              </ListRow>
            );
          }}
        />
      )}
    </PageShell>
  );
}
