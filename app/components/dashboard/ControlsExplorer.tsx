"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { CardTitle } from "@/components/ui/Card";
import { ControlList, type CheckResult } from "@/components/dashboard/ControlList";
import type { ControlWithStatus, Framework, Criticality } from "@/lib/db/queries";
import type { ControlStatus } from "@/lib/score";

type StatusFilter = "all" | ControlStatus;
type CritFilter = "all" | Criticality;

export function ControlsExplorer({
  controls,
  frameworks,
  health = {},
}: {
  controls: ControlWithStatus[];
  frameworks: Framework[];
  health?: Record<string, CheckResult>;
}) {
  const [fw, setFw] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [crit, setCrit] = useState<CritFilter>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return controls.filter((c) => {
      if (fw !== "all" && c.framework_id !== fw) return false;
      if (status !== "all" && c.status !== status) return false;
      if (crit !== "all" && c.criticality !== crit) return false;
      if (q && !`${c.code} ${c.title}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [controls, fw, status, crit, query]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-sm">Controls</CardTitle>
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search controls…"
              aria-label="Search controls"
              className="input w-44 py-1.5 pl-8"
            />
          </div>
          {frameworks.length > 1 && (
            <select value={fw} onChange={(e) => setFw(e.target.value)} className="input w-auto py-1.5">
              <option value="all">All frameworks</option>
              {frameworks.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
          <select
            value={crit}
            onChange={(e) => setCrit(e.target.value as CritFilter)}
            className="input w-auto py-1.5"
          >
            <option value="all">All priorities</option>
            <option value="core">Core</option>
            <option value="important">Important</option>
            <option value="operational">Operational</option>
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="input w-auto py-1.5"
          >
            <option value="all">All statuses</option>
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="complete">Complete</option>
          </select>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Showing {filtered.length} of {controls.length} controls
      </div>

      <ControlList controls={filtered} health={health} />
    </section>
  );
}
