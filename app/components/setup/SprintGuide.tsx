import Link from "next/link";
import { Check, Rocket, ArrowRight, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { buttonClasses } from "@/components/ui/Button";
import type { SprintPhase, SprintResult } from "@/lib/setup";

export interface OutstandingControl {
  id: string;
  code: string;
  title: string;
}

type PhaseState = "done" | "current" | "upcoming";

export function SprintGuide({
  sprint,
  outstandingCore,
}: {
  sprint: SprintResult;
  outstandingCore: OutstandingControl[];
}) {
  const { phases, currentIndex, completedCount, ready, score } = sprint;

  return (
    <div className="space-y-6">
      <Header completedCount={completedCount} total={phases.length} score={score} ready={ready} />
      <ol className="space-y-4">
        {phases.map((phase, i) => {
          const state: PhaseState = phase.done ? "done" : i === currentIndex ? "current" : "upcoming";
          return (
            <li key={phase.key}>
              <PhaseCard phase={phase} index={i} state={state} />
              {phase.key === "core" && state === "current" && outstandingCore.length > 0 && (
                <CoreList controls={outstandingCore} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Header({
  completedCount,
  total,
  score,
  ready,
}: {
  completedCount: number;
  total: number;
  score: number;
  ready: boolean;
}) {
  const headerShell =
    "card bg-gradient-to-br from-[var(--brand-navy)] to-[oklch(0.12_0.05_255)] text-white";

  if (ready) {
    return (
      <div className={headerShell}>
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--brand-emerald)]">
            <ShieldCheck className="h-6 w-6 text-black" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">You&rsquo;re audit-ready 🎉</h1>
            <p className="mt-1 opacity-80">
              All four sprint phases are complete. Book your audit — your pass-or-refund guarantee is
              locked in.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const pct = total === 0 ? 0 : Math.round((completedCount / total) * 100);
  return (
    <div className={headerShell}>
      <div className="flex items-center gap-2 text-sm opacity-80">
        <Rocket className="h-4 w-4" /> Your 14-Day Sprint
      </div>
      <h1 className="mt-2 text-2xl font-bold">
        {completedCount} of {total} phases done
      </h1>
      <p className="mt-1 opacity-80">
        Work the phases in order. Each gates on real progress — finish all four to hit audit-ready.
      </p>
      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/20">
        <div className="h-full bg-[var(--brand-emerald)] transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 text-xs opacity-70">Compliance score: {score}%</div>
    </div>
  );
}

function PhaseCard({
  phase,
  index,
  state,
}: {
  phase: SprintPhase;
  index: number;
  state: PhaseState;
}) {
  return (
    <div
      className={cn(
        "card flex items-start gap-4",
        state === "current" && "ring-2 ring-[var(--brand-emerald)]",
        state === "upcoming" && "opacity-60",
      )}
    >
      <div
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold",
          state === "done"
            ? "bg-[var(--brand-emerald)] text-black"
            : "bg-secondary text-foreground",
        )}
      >
        {state === "done" ? <Check className="h-4 w-4" strokeWidth={3} /> : index + 1}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-foreground">{phase.title}</h2>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {phase.progressLabel}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{phase.blurb}</p>
        {state !== "done" && (
          <Link href={phase.ctaHref} className={cn(buttonClasses("primary"), "mt-3 w-auto")}>
            {phase.ctaLabel}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  );
}

function CoreList({ controls }: { controls: OutstandingControl[] }) {
  return (
    <div className="ml-12 mt-2 rounded-lg border border-border bg-secondary/40 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Core controls still open
      </div>
      <ul className="space-y-1">
        {controls.map((c) => (
          <li key={c.id}>
            <Link
              href={`/controls/${c.id}`}
              className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-secondary"
            >
              <span className="truncate text-foreground">
                <span className="font-mono text-xs text-muted-foreground">{c.code}</span> {c.title}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
