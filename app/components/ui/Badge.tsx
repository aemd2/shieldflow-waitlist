import { cn } from "@/lib/cn";

// One badge to unify every status pill in the app. Pick a semantic variant; the
// colours live here only.
export type BadgeVariant = "neutral" | "success" | "warning" | "high" | "critical" | "info";

const VARIANT: Record<BadgeVariant, string> = {
  neutral: "border-border bg-secondary text-muted-foreground",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  high: "border-orange-200 bg-orange-50 text-orange-700",
  critical: "border-red-200 bg-red-50 text-red-700",
  info: "border-sky-200 bg-sky-50 text-sky-700",
};

export function Badge({
  variant = "neutral",
  icon,
  className,
  children,
}: {
  variant?: BadgeVariant;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        VARIANT[variant],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
