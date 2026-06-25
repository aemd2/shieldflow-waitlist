"use client";

import { useMemo, useState } from "react";
import { ControlList } from "@/components/dashboard/ControlList";
import type { ControlWithStatus, Framework } from "@/lib/db/queries";
import type { ControlStatus } from "@/lib/score";

type StatusFilter = "all" | ControlStatus;

export function ControlsExplorer({
  controls,
  frameworks,
}: {
  controls: ControlWithStatus[];
  frameworks: Framework[];
}) {
  const [fw, setFw] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  const filtered = useMemo(() => {
    return controls.filter((c) => {
      if (fw !== "all" && c.framework_id !== fw) return false;
      if (status !== "all" && c.status !== status) return false;
      return true;
    });
  }, [controls, fw, status]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Controls</h2>
        <div className="flex flex-wrap gap-2">
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

      <ControlList controls={filtered} />
    </section>
  );
}
