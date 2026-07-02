import { cn } from "@/lib/cn";

/**
 * Labeled group of related form fields — the form-side sibling of the sidebar
 * nav sections and the activity feed's date headers (same small uppercase
 * label treatment), so long forms read as a few scannable chunks instead of
 * one flat wall of inputs. Purely presentational.
 */
export function FormSection({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className={cn("space-y-3", className)}>
      <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </legend>
      {hint && <p className="-mt-2 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </fieldset>
  );
}
