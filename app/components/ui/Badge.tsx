import { cn } from "@/lib/cn";

// One badge to unify every status pill in the app. Pick a semantic variant; the
// colours live here only.
export type BadgeVariant = "neutral" | "success" | "warning" | "high" | "critical" | "info";

const VARIANT: Record<BadgeVariant, string> = {
  neutral: "border-border bg-secondary text-muted-foreground",
  success: "border-success-border bg-success-muted text-success",
  warning: "border-warning-border bg-warning-muted text-warning",
  // "high" sits between warning and critical on the severity ramp — the one
  // deliberate non-token shade, and it lives only here.
  high: "border-orange-200 bg-orange-50 text-orange-700",
  critical: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-info-border bg-info-muted text-info",
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
