import {
  CheckCircle2,
  SlidersHorizontal,
  Upload,
  Trash2,
  FileText,
  Building2,
  ShieldAlert,
  GraduationCap,
  UserPlus,
  UserMinus,
  UserCheck,
  Settings,
  Plug,
  PlugZap,
  Sparkles,
  Layers,
  Activity as ActivityIcon,
  type LucideIcon,
} from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { ListRow } from "@/components/ui/ListCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { DateGroupedList } from "@/components/ui/DateGroupedList";
import { timeAgo, formatDateTime, dateGroupLabel } from "@/lib/format";
import type { AuditEvent } from "@/lib/db/queries";

/** A label rendered in the foreground colour + medium weight, to stand out
 *  inside the otherwise-muted activity sentence. */
function strong(text: string) {
  return <span className="font-medium text-foreground">{text}</span>;
}

type Formatted = {
  icon: LucideIcon;
  variant: BadgeVariant;
  category: string;
  predicate: React.ReactNode;
};

function statusLabel(s: unknown): string {
  const map: Record<string, string> = {
    not_started: "not started",
    in_progress: "in progress",
    complete: "complete",
  };
  if (typeof s !== "string") return "";
  return map[s] ?? s.replace(/_/g, " ");
}

/** Pure action → { icon, badge, human sentence } mapper. The actor is rendered
 *  by the row; this returns only the predicate (what they did). */
function formatEvent(e: AuditEvent): Formatted {
  const label = e.target_label?.trim() || null;
  const named = label ? strong(label) : null;
  const m = (e.metadata ?? {}) as Record<string, unknown>;

  switch (e.action) {
    case "control.status_changed": {
      const to = statusLabel(m.to);
      return {
        icon: CheckCircle2,
        variant: "info",
        category: "Control",
        predicate: (
          <>
            set {named ?? "a control"}
            {to ? <> to {strong(to)}</> : null}
          </>
        ),
      };
    }
    case "control.updated":
      return {
        icon: SlidersHorizontal,
        variant: "info",
        category: "Control",
        predicate: <>updated {named ?? "a control"}</>,
      };

    case "evidence.uploaded":
      return { icon: Upload, variant: "success", category: "Evidence", predicate: <>uploaded evidence {named}</> };
    case "evidence.deleted":
      return { icon: Trash2, variant: "neutral", category: "Evidence", predicate: <>deleted evidence {named}</> };

    case "policy.created":
      return { icon: FileText, variant: "success", category: "Policy", predicate: <>created policy {named}</> };
    case "policy.updated":
      return { icon: FileText, variant: "info", category: "Policy", predicate: <>updated policy {named}</> };
    case "policy.deleted":
      return { icon: Trash2, variant: "neutral", category: "Policy", predicate: <>deleted policy {named}</> };

    case "vendor.created":
      return { icon: Building2, variant: "success", category: "Vendor", predicate: <>added vendor {named}</> };
    case "vendor.updated":
      return { icon: Building2, variant: "info", category: "Vendor", predicate: <>updated vendor {named}</> };
    case "vendor.deleted":
      return { icon: Trash2, variant: "neutral", category: "Vendor", predicate: <>removed vendor {named}</> };

    case "risk.created":
      return { icon: ShieldAlert, variant: "warning", category: "Risk", predicate: <>added risk {named}</> };
    case "risk.updated":
      return { icon: ShieldAlert, variant: "info", category: "Risk", predicate: <>updated risk {named}</> };
    case "risk.deleted":
      return { icon: Trash2, variant: "neutral", category: "Risk", predicate: <>removed risk {named}</> };

    case "training.created":
      return { icon: GraduationCap, variant: "success", category: "Training", predicate: <>assigned training {named}</> };
    case "training.updated":
      return { icon: GraduationCap, variant: "info", category: "Training", predicate: <>updated training {named}</> };
    case "training.deleted":
      return { icon: Trash2, variant: "neutral", category: "Training", predicate: <>removed training {named}</> };

    case "member.invited":
      return { icon: UserPlus, variant: "info", category: "Team", predicate: <>invited {named ?? "a teammate"}</> };
    case "invite.revoked":
      return {
        icon: UserMinus,
        variant: "neutral",
        category: "Team",
        predicate: <>revoked the invite for {named ?? "a teammate"}</>,
      };
    case "member.removed":
      return { icon: UserMinus, variant: "warning", category: "Team", predicate: <>removed {named ?? "a member"}</> };
    case "member.joined":
      return { icon: UserCheck, variant: "success", category: "Team", predicate: <>joined the workspace</> };

    case "trust_center.updated":
      return {
        icon: Settings,
        variant: "neutral",
        category: "Settings",
        predicate: <>{m.enabled === false ? "disabled" : "updated"} the {strong("Trust Center")}</>,
      };

    case "integration.connected":
      return {
        icon: PlugZap,
        variant: "success",
        category: "Integration",
        predicate: <>connected {named ?? "an integration"}</>,
      };
    case "integration.disconnected":
      return {
        icon: Plug,
        variant: "neutral",
        category: "Integration",
        predicate: <>disconnected {named ?? "an integration"}</>,
      };

    case "company.created":
      return { icon: Sparkles, variant: "success", category: "Workspace", predicate: <>created the workspace {named}</> };
    case "framework.added":
      return { icon: Layers, variant: "info", category: "Workspace", predicate: <>added the {named ?? "framework"} framework</> };

    default:
      return {
        icon: ActivityIcon,
        variant: "neutral",
        category: "Activity",
        predicate: (
          <>
            {e.action.trim() ? e.action.replace(/[._]/g, " ") : "made a change"}
            {named ? <> {named}</> : null}
          </>
        ),
      };
  }
}

export function ActivityFeed({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={<ActivityIcon className="h-6 w-6" />}
        title="No activity yet"
        description="Changes will show up here as your team works — every status change, upload, and edit, with who did it and when."
      />
    );
  }

  // Events arrive newest-first, so same-day entries are already consecutive —
  // group them under a date header (Today / Yesterday / ...) instead of one
  // long undifferentiated list, the standard pattern for activity feeds.
  const groups: { label: string; items: AuditEvent[] }[] = [];
  for (const e of events) {
    const label = dateGroupLabel(e.created_at);
    const current = groups[groups.length - 1];
    if (current && current.label === label) current.items.push(e);
    else groups.push({ label, items: [e] });
  }

  return (
    <DateGroupedList
      groups={groups}
      renderItem={(e) => {
        const f = formatEvent(e);
        const Icon = f.icon;
        const actor = e.actor_email ?? "System";
        return (
          <ListRow key={e.id} className="items-start">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 shrink-0 rounded-full bg-secondary p-1.5 text-muted-foreground">
                <Icon className="h-4 w-4" />
              </span>
              <p className="min-w-0 break-words text-sm text-muted-foreground">
                {strong(actor)} {f.predicate}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Badge variant={f.variant}>{f.category}</Badge>
              <time
                dateTime={e.created_at}
                title={formatDateTime(e.created_at)}
                className="shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground"
              >
                {timeAgo(e.created_at)}
              </time>
            </div>
          </ListRow>
        );
      }}
    />
  );
}
