import { CheckCircle2, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/cn";

export type AlertVariant = "success" | "error" | "warning" | "info";

const VARIANT: Record<AlertVariant, { cls: string; Icon: typeof Info }> = {
  success: {
    cls: "border-[var(--brand-emerald)]/40 bg-emerald-50 text-emerald-800",
    Icon: CheckCircle2,
  },
  error: { cls: "border-destructive/30 bg-destructive/10 text-destructive", Icon: AlertCircle },
  warning: { cls: "border-amber-300 bg-amber-50 text-amber-800", Icon: AlertTriangle },
  info: { cls: "border-border bg-secondary text-muted-foreground", Icon: Info },
};

export function Alert({
  variant = "info",
  icon = true,
  className,
  children,
}: {
  variant?: AlertVariant;
  icon?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const { cls, Icon } = VARIANT[variant];
  return (
    <div className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", cls, className)}>
      {icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
