"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronRight, Paperclip, Search } from "lucide-react";
import { updateMeasureStatus } from "@/app/actions/measures";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { MeasureEvidence } from "@/components/measures/MeasureEvidence";
import { cn } from "@/lib/cn";
import type { MeasureWithStatus } from "@/lib/db/queries";
import type { ControlStatus } from "@/lib/score";

const STATUS: Record<ControlStatus, { label: string; variant: BadgeVariant }> = {
  not_started: { label: "Not started", variant: "neutral" },
  in_progress: { label: "In progress", variant: "warning" },
  complete: { label: "Complete", variant: "success" },
};

const OPTIONS: ControlStatus[] = ["not_started", "in_progress", "complete"];

type Filter = "all" | "mandatory" | "open";

export function MeasureManager({
  measures: serverMeasures,
  canWrite,
  companyId,
}: {
  measures: MeasureWithStatus[];
  canWrite: boolean;
  companyId: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // The status the user just chose, shown straight away. Without it the row sat
  // on its old status until router.refresh() landed — after the save had already
  // re-enabled the buttons — so "Complete" visibly flicked back to "Not started".
  // An override is dropped once the server's copy agrees, or rolled back on error.
  const [chosen, setChosen] = useState<Record<string, ControlStatus>>({});
  const settled = Object.keys(chosen).filter(
    (id) => serverMeasures.find((m) => m.id === id)?.status === chosen[id],
  );
  if (settled.length) {
    setChosen((c) => {
      const next = { ...c };
      for (const id of settled) delete next[id];
      return next;
    });
  }
  const measures = useMemo(
    () => serverMeasures.map((m) => (chosen[m.id] ? { ...m, status: chosen[m.id] } : m)),
    [serverMeasures, chosen],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return measures.filter((m) => {
      if (filter === "mandatory" && m.importance !== "mandatory") return false;
      if (filter === "open" && m.status === "complete") return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        (m.summary ?? "").toLowerCase().includes(q) ||
        m.controls.some((c) => c.code.toLowerCase().includes(q))
      );
    });
  }, [measures, query, filter]);

  const byCategory = useMemo(() => {
    const map = new Map<string, MeasureWithStatus[]>();
    for (const m of visible) {
      const list = map.get(m.category);
      if (list) list.push(m);
      else map.set(m.category, [m]);
    }
    return map;
  }, [visible]);

  const done = measures.filter((m) => m.status === "complete").length;
  // How many requirement links the completed measures cover — the number that
  // makes the "do it once, counts everywhere" point concrete.
  const coveredLinks = measures
    .filter((m) => m.status === "complete")
    .reduce((n, m) => n + m.controls.length, 0);
  const totalLinks = measures.reduce((n, m) => n + m.controls.length, 0);

  function setStatus(m: MeasureWithStatus, next: ControlStatus) {
    if (!canWrite || next === m.status) return;
    setPendingId(m.id);
    setError(null);
    setChosen((c) => ({ ...c, [m.id]: next }));
    startTransition(async () => {
      const res = await updateMeasureStatus({ measureId: m.id, status: next });
      setPendingId(null);
      if (res?.error) {
        setChosen((c) => {
          const rest = { ...c };
          delete rest[m.id];
          return rest;
        });
        setError(res.error);
      } else router.refresh();
    });
  }

  if (measures.length === 0) {
    return <EmptyState description="No measures yet." />;
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div>
            <span className="text-2xl font-bold text-foreground">
              {done} of {measures.length}
            </span>
            <span className="ml-2 text-sm text-muted-foreground">measures done</span>
          </div>
          <div className="text-sm text-muted-foreground">
            covering{" "}
            <span className="font-semibold text-foreground">
              {coveredLinks} of {totalLinks}
            </span>{" "}
            framework requirement links
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Completing a measure moves every requirement it satisfies forward. It never moves a
          control backwards — a status you set by hand stays yours.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search measures or a control code…"
            className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm"
          />
        </div>
        {(["all", "mandatory", "open"] as Filter[]).map((f) => (
          <Button
            key={f}
            type="button"
            variant={filter === f ? "accent" : "outline"}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f === "mandatory" ? "Mandatory" : "Not done"}
          </Button>
        ))}
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}

      {visible.length === 0 ? (
        <EmptyState description="No measures match this filter." />
      ) : (
        Array.from(byCategory.entries()).map(([category, items]) => (
          <section key={category} className="card p-0">
            <div className="border-b border-border px-5 py-3 text-sm font-semibold">
              {category}
              <span className="ml-2 font-normal text-muted-foreground">
                {items.filter((i) => i.status === "complete").length} of {items.length}
              </span>
            </div>
            <ul className="divide-y divide-border">
              {items.map((m) => {
                const expanded = open[m.id] ?? false;
                const s = STATUS[m.status];
                return (
                  <li key={m.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setOpen((o) => ({ ...o, [m.id]: !expanded }))}
                        className="flex min-w-0 flex-1 items-start gap-2 text-left"
                      >
                        {expanded ? (
                          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{m.name}</span>
                            <Badge variant={s.variant}>{s.label}</Badge>
                            {m.importance !== "mandatory" && (
                              <Badge variant="info">{m.importance}</Badge>
                            )}
                            {m.evidence.length > 0 && (
                              <span
                                className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"
                                title="Files attached to this measure"
                              >
                                <Paperclip className="h-3 w-3" />
                                {m.evidence.length}
                              </span>
                            )}
                          </span>
                          {m.summary && (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {m.summary}
                            </span>
                          )}
                          <span className="mt-1 flex flex-wrap gap-1">
                            {m.controls.map((c) => (
                              <span
                                key={c.id}
                                className="rounded border border-border bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground"
                                title={`${c.framework} · ${c.title}`}
                              >
                                {c.code}
                              </span>
                            ))}
                          </span>
                        </span>
                      </button>

                      {canWrite && (
                        <div className="flex shrink-0 flex-wrap gap-1">
                          {OPTIONS.map((opt) => (
                            <Button
                              key={opt}
                              type="button"
                              disabled={pendingId === m.id}
                              variant={m.status === opt ? "accent" : "outline"}
                              onClick={() => setStatus(m, opt)}
                            >
                              {STATUS[opt].label}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>

                    {expanded && (
                      <div className="mt-3 space-y-3 border-l-2 border-border pl-6 text-sm">
                        {m.guidance && <p className="text-muted-foreground">{m.guidance}</p>}
                        {m.suggested_evidence && (
                          <div className="rounded-md bg-secondary/40 p-3">
                            <div className="text-xs font-semibold">
                              Evidence auditors typically expect
                            </div>
                            <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                              {m.suggested_evidence
                                .split("\n")
                                .map((l) => l.trim())
                                .filter(Boolean)
                                .map((l) => (
                                  <li key={l}>{l}</li>
                                ))}
                            </ul>
                          </div>
                        )}
                        <MeasureEvidence
                          companyId={companyId}
                          measureId={m.id}
                          files={m.evidence}
                          requirementCount={m.controls.length}
                          canWrite={canWrite}
                        />
                        <div>
                          <div className="text-xs font-semibold">Satisfies</div>
                          <ul className="mt-1 space-y-1">
                            {m.controls.map((c) => (
                              <li key={c.id} className="text-xs">
                                <Link
                                  href={`/controls/${c.id}`}
                                  className="text-primary hover:underline"
                                >
                                  {c.code}
                                </Link>
                                <span className="text-muted-foreground">
                                  {" "}
                                  · {c.title}
                                  {c.framework && (
                                    <span className="opacity-70"> ({c.framework})</span>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
