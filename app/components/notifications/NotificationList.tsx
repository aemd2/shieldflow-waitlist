"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { markNotificationRead, markAllNotificationsRead } from "@/app/actions/notifications";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListCard, ListRow } from "@/components/ui/ListCard";
import { FeedLayout } from "@/components/ui/layouts";
import { timeAgo, formatDateTime } from "@/lib/format";
import type { Notification } from "@/lib/db/queries";

const NETWORK = "Network problem — check your connection and try again.";

export function NotificationList({ notifications }: { notifications: Notification[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const hasUnread = notifications.some((n) => !n.read_at);

  function open(n: Notification) {
    start(async () => {
      if (!n.read_at) {
        const res = await markNotificationRead(n.id).catch(() => ({ error: NETWORK }));
        if (res?.error) {
          toast("error", res.error);
          return;
        }
      }
      if (n.link) router.push(n.link);
      else router.refresh();
    });
  }

  function markAll() {
    start(async () => {
      const res = await markAllNotificationsRead().catch(() => ({ error: NETWORK }));
      if (res?.error) toast("error", res.error);
      else {
        toast("success", "All marked as read");
        router.refresh();
      }
    });
  }

  if (notifications.length === 0) {
    return (
      <EmptyState
        icon={<Bell className="h-6 w-6" />}
        title="No notifications yet"
        description="Updates about your controls, integrations and team will show up here."
      />
    );
  }

  return (
    <FeedLayout
      toolbar={
        hasUnread ? (
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={markAll}
              disabled={pending}
              leftIcon={<CheckCheck className="h-4 w-4" />}
            >
              Mark all read
            </Button>
          </div>
        ) : undefined
      }
    >
      <ListCard>
        {notifications.map((n) => (
          <ListRow key={n.id} className={n.read_at ? "" : "bg-secondary/40"}>
            <button
              onClick={() => open(n)}
              disabled={pending}
              className="flex min-w-0 flex-1 items-start gap-3 text-left"
            >
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  n.read_at ? "bg-transparent" : "bg-destructive"
                }`}
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">{n.title}</span>
                {n.body && <span className="block text-xs text-muted-foreground">{n.body}</span>}
                <span
                  className="mt-0.5 block text-xs text-muted-foreground"
                  title={formatDateTime(n.created_at)}
                >
                  {timeAgo(n.created_at)}
                </span>
              </span>
            </button>
          </ListRow>
        ))}
      </ListCard>
    </FeedLayout>
  );
}
