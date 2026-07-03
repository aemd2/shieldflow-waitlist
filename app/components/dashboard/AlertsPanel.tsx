import Link from "next/link";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";
import type { Alert, AlertSeverity } from "@/lib/monitoring";

const STYLE: Record<AlertSeverity, { cls: string; Icon: typeof Info }> = {
  high: { cls: "border-destructive/30 bg-destructive/10 text-destructive", Icon: AlertCircle },
  warning: { cls: "border-amber-300 bg-amber-50 text-amber-800", Icon: AlertTriangle },
  info: { cls: "border-border bg-secondary text-muted-foreground", Icon: Info },
};

export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  return (
    <section className="card p-0">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold text-foreground">Monitoring &amp; alerts</h2>
        <span className="text-xs text-muted-foreground">{alerts.length} active</span>
      </div>

      {alerts.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          ✓ All clear — no issues detected.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {alerts.map((a) => {
            const { cls, Icon } = STYLE[a.severity];
            const body = (
              <div className={`flex items-start gap-3 px-5 py-3 ${a.controlId ? "hover:bg-secondary" : ""}`}>
                <span className={`mt-0.5 rounded-md border p-1 ${cls}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{a.title}</div>
                  <div className="text-xs text-muted-foreground">{a.detail}</div>
                </div>
              </div>
            );
            return (
              <li key={a.id}>
                {a.controlId ? <Link href={`/controls/${a.controlId}`}>{body}</Link> : body}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
