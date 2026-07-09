"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { addFramework } from "@/app/actions/frameworks";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";

export interface AvailableFramework {
  id: string;
  name: string;
  controlCount: number;
}

const NETWORK = "Network problem — check your connection and try again.";

/**
 * Self-serve "add another framework" — matches Vanta's simplest pattern
 * (a button, not a sales-gated flow). Adding a framework seeds new controls
 * at 0%, which can lower the compliance score and reopen an already
 * audit-ready company's 14-Day Sprint — a plain confirm() surfaces that
 * up front rather than letting it be a silent surprise (matches the existing
 * disconnect-integration pattern; this is an additive scope change, not a
 * delete, so the newer undo-toast pattern doesn't apply here).
 */
export function AddFrameworkButton({
  available,
  canManage,
}: {
  available: AvailableFramework[];
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(available[0]?.id ?? "");

  // `available` shrinks after each successful add (server props refresh via
  // router.refresh()), but useState's initializer only runs once at mount —
  // `choice` would otherwise keep pointing at a framework that's already
  // been added. Self-heals only when the current choice is actually stale,
  // so it doesn't yank a valid in-progress selection on unrelated re-renders.
  useEffect(() => {
    if (!available.some((f) => f.id === choice)) {
      setChoice(available[0]?.id ?? "");
    }
  }, [available, choice]);

  if (!canManage) return null;

  if (available.length === 0) {
    return <p className="text-xs text-muted-foreground">All frameworks added.</p>;
  }

  function submit() {
    const framework = available.find((f) => f.id === choice);
    if (!framework) return;
    const ok = confirm(
      `Add ${framework.name}? This adds ${framework.controlCount} new control${framework.controlCount === 1 ? "" : "s"} at 0% and may lower your compliance score and reopen your 14-Day Sprint until they're addressed.`,
    );
    if (!ok) return;

    start(async () => {
      const res = await addFramework({ frameworkId: framework.id }).catch(() => ({ error: NETWORK }));
      if (res?.error) {
        toast("error", res.error);
        return;
      }
      toast("success", `${framework.name} added`);
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>
        Add framework
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={choice} onChange={(e) => setChoice(e.target.value)} className="w-auto">
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
  );
}
