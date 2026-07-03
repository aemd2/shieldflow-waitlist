"use client";

import { X } from "lucide-react";
import { Chat } from "./Chat";
import { Alert } from "@/components/ui/Alert";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

/**
 * Always mounted (never unmounted) so an in-flight AI stream or a draft
 * question survives closing the panel or navigating to another page —
 * open/closed is purely a transform + pointer-events toggle, same idiom as
 * MobileNav's slide-out drawer, just docked right instead of left.
 */
export function CopilotPanel({
  open,
  onClose,
  initialMessages,
  aiEnabled,
}: {
  open: boolean;
  onClose: () => void;
  initialMessages: Msg[];
  aiEnabled: boolean;
}) {
  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <aside
        className={`absolute right-0 top-0 flex h-full w-full max-w-lg flex-col border-l border-border bg-secondary shadow-xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Compliance Co-Pilot</h2>
            <p className="truncate text-xs text-muted-foreground">Grounded in your live data.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Co-Pilot"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          {!aiEnabled && (
            <Alert variant="warning">
              AI is not configured yet. Add a <code>GROQ_API_KEY</code> to <code>.env.local</code> to
              start chatting.
            </Alert>
          )}
          <Chat initialMessages={initialMessages} aiEnabled={aiEnabled} />
        </div>
      </aside>
    </div>
  );
}
