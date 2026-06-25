import Link from "next/link";
import { Paperclip, User, CalendarClock } from "lucide-react";
import type { ControlWithStatus } from "@/lib/db/queries";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

const STATUS_LABEL: Record<string, { text: string; variant: BadgeVariant }> = {
  not_started: { text: "Not started", variant: "neutral" },
  in_progress: { text: "In progress", variant: "warning" },
  complete: { text: "Complete", variant: "success" },
};

function isOverdue(c: ControlWithStatus): boolean {
  if (c.status === "complete" || !c.due_date) return false;
  const due = new Date(c.due_date);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

export function ControlList({ controls }: { controls: ControlWithStatus[] }) {
  if (controls.length === 0) {
    return <EmptyState description="No controls match this filter." />;
  }

  const byCategory = controls.reduce<Record<string, ControlWithStatus[]>>((acc, c) => {
    const k = c.category ?? "Uncategorized";
    (acc[k] ||= []).push(c);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {Object.entries(byCategory).map(([category, items]) => (
        <section key={category} className="card p-0">
          <div className="border-b border-border px-6 py-3 text-sm font-semibold text-foreground">
            {category}
          </div>
          <ul className="divide-y divide-border">
            {items.map((c) => {
              const s = STATUS_LABEL[c.status];
              return (
                <li key={c.id}>
                  <Link
                    href={`/controls/${c.id}`}
                    className="flex items-center justify-between gap-4 px-6 py-3 hover:bg-secondary"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">
                        <span className="text-muted-foreground">{c.code}</span> &middot; {c.title}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {c.evidenceCount > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Paperclip className="h-3 w-3" /> {c.evidenceCount}
                          </span>
                        )}
                        {c.owner_email && (
                          <span className="inline-flex items-center gap-1">
                            <User className="h-3 w-3" /> {c.owner_email}
                          </span>
                        )}
                        {c.due_date && (
                          <span
                            className={`inline-flex items-center gap-1 ${
                              isOverdue(c) ? "font-medium text-destructive" : ""
                            }`}
                          >
                            <CalendarClock className="h-3 w-3" /> {c.due_date}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge variant={s.variant}>{s.text}</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
