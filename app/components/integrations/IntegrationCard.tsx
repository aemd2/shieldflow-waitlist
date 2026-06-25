import { CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/Badge";

export type IntegrationCardStatus = "connected" | "error" | "available" | "coming_soon";

/**
 * Shared card shell for the integrations catalog. Status badge + consistent
 * layout; the connect/sync controls come in as children from each provider's
 * own client component.
 */
export function IntegrationCard({
  name,
  description,
  icon,
  status,
  children,
}: {
  name: string;
  description: string;
  icon: React.ReactNode;
  status: IntegrationCardStatus;
  children?: React.ReactNode;
}) {
  return (
    <div className={`card flex flex-col gap-4 ${status === "coming_soon" ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary">
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">{name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: IntegrationCardStatus }) {
  if (status === "connected") {
    return <Badge variant="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>Connected</Badge>;
  }
  if (status === "error") {
    return <Badge variant="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>Needs reconnect</Badge>;
  }
  if (status === "coming_soon") {
    return <Badge variant="neutral" icon={<Clock className="h-3.5 w-3.5" />}>Coming soon</Badge>;
  }
  return null;
}
