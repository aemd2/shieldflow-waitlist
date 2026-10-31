"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { addFramework, removeFramework } from "@/app/actions/frameworks";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";

export interface AvailableFramework {
  id: string;
  name: string;
  controlCount: number;
}

export interface SelectedFramework {
  id: string;
  name: string;
  /** Controls this framework contributes to the workspace. */
  controlCount: number;
  /** Completion across those controls, 0-100. */
  pct: number;
}

const NETWORK = "Network problem — check your connection and try again.";

/**
 * Add or remove a framework, and show where each one stands.
 *
 * Was AddFrameworkButton, which could only add — a wrong pick at onboarding was
 * permanent, inflating the control count and sinking the score with no way out.
 * A reviewer called the edit path "convoluted"; there wasn't one.
 *
 * The progress bars used to live separately on the dashboard while this
 * rendered a row of chips, so the same frameworks were drawn twice from the
 * same data in two places. When a removal silently failed, the optimistic chip
 * vanished and the server-rendered bar stayed: "Frameworks in scope: SOC 2"
 * above bars for three frameworks. Merging them into one card per framework
 * makes that contradiction impossible to draw, and gives the remove control a
 * target bigger than 12 pixels on an action that changes the whole scoreboard.
 *
 * Adding uses a plain confirm() because it is a scope increase that can lower
 * the score and reopen the Sprint, and the user should see that before it
 * happens. Removing uses the optimistic-hide-plus-undo-toast pattern instead:
 * it is reversible with no data loss (see removeFramework), so an extra
 * confirmation dialog on a safe action is friction for nothing.
 */
export function FrameworkManager({
  available,
  selected,
  canManage,
}: {
  available: AvailableFramework[];
  selected: SelectedFramework[];
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(available[0]?.id ?? "");
  // Optimistic: drop the chip immediately, restore it if the server disagrees.
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // `available` shrinks after each successful add (server props refresh via
  // router.refresh()), but useState's initializer only runs once at mount —
  // `choice` would otherwise keep pointing at a framework that's already
  // been added. A stale choice falls back to the first one still available,
  // without yanking a valid in-progress selection on unrelated re-renders.
  const current = available.some((f) => f.id === choice) ? choice : (available[0]?.id ?? "");
  const visible = selected.filter((f) => !hidden.has(f.id));

  // Deliberately NOT an early return. The progress cards moved into this
  // component, and bailing out here would hide every framework's progress from
  // members and auditors — people who can't change scope but absolutely need to
  // see where it stands. Only the controls are gated.

  function submit() {
    const framework = available.find((f) => f.id === current);
    if (!framework) return;
    const ok = confirm(
      `Add ${framework.name}? This adds ${framework.controlCount} control${framework.controlCount === 1 ? "" : "s"}. Any already covered by measures you've worked on are credited straight away; the rest start at 0%, so your compliance score may dip and your 14-Day Sprint may reopen until they're addressed.`,
    );
    if (!ok) return;

    start(async () => {
      const res = await addFramework({ frameworkId: framework.id }).catch(() => ({ error: NETWORK }));
      if (res?.error) {
        toast("error", res.error);
        return;
      }
      // Say how much was already done — that's the whole point of shared
      // measures, and without it the new framework just looks like more work.
      const credited = res && "credited" in res ? (res.credited ?? 0) : 0;
      toast(
        "success",
        credited > 0
          ? `${framework.name} added — ${credited} requirement${credited === 1 ? "" : "s"} already credited from work you've done`
          : `${framework.name} added`,
      );
      setOpen(false);
      router.refresh();
    });
  }

  function drop(framework: SelectedFramework) {
    setHidden((prev) => new Set(prev).add(framework.id));
    start(async () => {
      const res = await removeFramework({ frameworkId: framework.id }).catch(() => ({ error: NETWORK }));
      if (res?.error) {
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(framework.id);
          return next;
        });
        toast("error", res.error);
        return;
      }
      // Only offer Undo when the server says a re-add would be allowed. The
      // plan cap can refuse it, and an Undo button that errors is worse than
      // no Undo button — it turns a safe action into one the user no longer
      // trusts.
      const canUndo = res && "canUndo" in res ? res.canUndo !== false : true;
      toast(
        "success",
        canUndo
          ? `${framework.name} removed — your progress and evidence are kept`
          : `${framework.name} removed — your progress and evidence are kept, but your plan won't allow adding it back`,
        canUndo ? { label: "Undo", onClick: () => restore(framework) } : undefined,
      );
      router.refresh();
    });
  }

  function restore(framework: SelectedFramework) {
    start(async () => {
      const res = await addFramework({ frameworkId: framework.id }).catch(() => ({ error: NETWORK }));
      if (res?.error) {
        toast("error", res.error);
        return;
      }
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(framework.id);
        return next;
      });
      toast("success", `${framework.name} restored`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {visible.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-foreground">Frameworks in scope</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((f) => (
              <div key={f.id} className="card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{f.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {f.controlCount} {f.controlCount === 1 ? "control" : "controls"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm tabular-nums text-muted-foreground">{f.pct}%</span>
                    {canManage && visible.length > 1 && (
                      <button
                        type="button"
                        onClick={() => drop(f)}
                        disabled={pending}
                        aria-label={`Remove ${f.name}`}
                        title={`Remove ${f.name} — your progress and evidence are kept`}
                        className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full bg-[var(--brand-emerald)] transition-all"
                    style={{ width: `${f.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {!canManage ? null : available.length === 0 ? (
        <p className="text-xs text-muted-foreground">All frameworks added.</p>
      ) : !open ? (
        <Button variant="outline" onClick={() => setOpen(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>
          Add framework
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={current} onChange={(e) => setChoice(e.target.value)} className="w-auto">
            {available.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
          <Button onClick={submit} loading={pending} leftIcon={<Plus className="h-3.5 w-3.5" />}>
            Add
          </Button>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
