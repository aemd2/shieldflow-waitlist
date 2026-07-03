import { Fragment } from "react";
import type { Risk } from "@/lib/db/queries";

// Likelihood rows run high→low (so the dangerous corner sits top-right); impact
// columns run low→high. Each cell is coloured by its severity and shows the count
// of open risks whose effective (residual, else inherent) score lands there.
const LIKELIHOODS = ["high", "medium", "low"] as const;
const IMPACTS = ["low", "medium", "high"] as const;

const LVL: Record<string, number> = { low: 1, medium: 2, high: 3 };
function sev(l: string, i: string): "low" | "medium" | "high" | "critical" {
  const s = LVL[l] + LVL[i];
  if (s >= 6) return "critical";
  if (s === 5) return "high";
  if (s === 4) return "medium";
  return "low";
}
const CELL: Record<string, string> = {
  low: "bg-success-muted text-success",
  medium: "bg-warning-muted text-warning",
  // "high" stays the deliberate one-off orange shade from Badge.tsx's severity ramp.
  high: "bg-orange-100 text-orange-800",
  critical: "bg-destructive/10 text-destructive",
};
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function RiskHeatmap({ risks }: { risks: Risk[] }) {
  const open = risks.filter((r) => r.status !== "closed" && r.status !== "accepted");
  if (open.length === 0) return null;

  const count = (l: string, i: string) =>
    open.filter(
      (r) => (r.residual_likelihood ?? r.likelihood) === l && (r.residual_impact ?? r.impact) === i,
    ).length;

  return (
    <div className="card">
      <h2 className="mb-1 text-sm font-semibold text-foreground">Risk heat-map</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Open risks by residual likelihood × impact (inherent where residual isn&apos;t set).
      </p>
      <div className="grid grid-cols-[5rem_1fr_1fr_1fr] gap-1">
        <div />
        <div className="pb-1 text-center text-xs text-muted-foreground">Low</div>
        <div className="pb-1 text-center text-xs text-muted-foreground">Medium</div>
        <div className="pb-1 text-center text-xs text-muted-foreground">High</div>
        {LIKELIHOODS.map((l) => (
          <Fragment key={l}>
            <div className="flex items-center justify-end pr-2 text-xs text-muted-foreground">{cap(l)}</div>
            {IMPACTS.map((i) => {
              const c = count(l, i);
              return (
                <div
                  key={i}
                  className={`flex h-14 items-center justify-center rounded ${CELL[sev(l, i)]}`}
                  title={`${cap(l)} likelihood / ${cap(i)} impact`}
                >
                  <span className="text-base font-semibold">{c || ""}</span>
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
      <div className="mt-1 text-right text-xs text-muted-foreground">Impact →</div>
    </div>
  );
}
