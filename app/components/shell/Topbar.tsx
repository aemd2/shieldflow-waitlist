import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/Button";
import { MobileNav } from "./MobileNav";
import type { NavRole } from "./nav-items";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { CopilotTriggerButton } from "@/components/copilot/CopilotTriggerButton";

export function Topbar({
  email,
  companyName,
  role = null,
  readOnly,
  unread = 0,
  sprintReady = false,
}: {
  email: string;
  companyName?: string;
  role?: NavRole | null;
  readOnly?: boolean;
  unread?: number;
  sprintReady?: boolean;
}) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-6 py-3 print:hidden">
      <div className="flex min-w-0 items-center gap-2">
        {companyName && <MobileNav companyName={companyName} role={role} sprintReady={sprintReady} />}
        <div className="truncate text-sm text-muted-foreground">{email}</div>
        {readOnly && (
          <span className="shrink-0 rounded-full border border-warning-border bg-warning-muted px-2 py-0.5 text-xs font-medium text-warning">
            Read-only · Auditor
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {companyName && <CopilotTriggerButton />}
        {companyName && <NotificationBell unread={unread} />}
        <form action={signOut}>
          <Button type="submit" size="sm" variant="outline">Sign out</Button>
        </form>
      </div>
    </header>
  );
}
