import { cn } from "@/lib/cn";
import type { Criticality } from "@/lib/db/queries";

// Visual tier for a control's criticality. "Core" is emphasized (the
// auditor-critical, must-pass controls); the others stay muted so they don't
// shout. Shared by the control detail header and the controls list rows.
const STYLES: Record<Criticality, { label: string; cls: string }> = {
  core: { label: "Core", cls: "border-success-border bg-success-muted text-success" },
  important: { label: "Important", cls: "border-border bg-secondary text-muted-foreground" },
  operational: { label: "Operational", cls: "border-border bg-secondary text-muted-foreground" },
};

export function CriticalityBadge({
  criticality,
  className,
}: {
  criticality: Criticality;
  className?: string;
}) {
  const s = STYLES[criticality];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        s.cls,
        className,
      )}
    >
      {s.label}
    </span>
  );
}
