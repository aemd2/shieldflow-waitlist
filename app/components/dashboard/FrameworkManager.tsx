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
}

const NETWORK = "Network problem — check your connection and try again.";

/**
 * Add or remove a framework. Was AddFrameworkButton, which could only add —
 * a wrong pick at onboarding was permanent, inflating the control count and
 * sinking the score with no way out. A reviewer called the edit path
 * "convoluted"; there wasn't one.
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

  if (!canManage) return null;

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
      toast("success", `${framework.name} removed — your progress on it is kept`, {
        label: "Undo",
        onClick: () => restore(framework),
      });
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Frameworks in scope:</span>
          {visible.map((f) => (
            <span
              key={f.id}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs text-foreground"
            >
              {f.name}
              {visible.length > 1 && (
                <button
                  type="button"
                  onClick={() => drop(f)}
                  disabled={pending}
                  aria-label={`Remove ${f.name}`}
                  title={`Remove ${f.name} — your progress on it is kept`}
                  className="ml-0.5 rounded-full p-0.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {available.length === 0 ? (
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
