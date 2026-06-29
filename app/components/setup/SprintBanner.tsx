"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Rocket, ArrowRight, X } from "lucide-react";

const DISMISS_KEY = "sprintBannerDismissed";

/**
 * Compact "continue your sprint" nudge on the dashboard. The parent only renders
 * it while the workspace is not yet audit-ready; this component just handles the
 * dismiss-for-later UI state (localStorage — non-sensitive, no server round-trip).
 * Starts hidden so server and first client render match (no hydration mismatch),
 * then reveals after reading localStorage.
 */
export function SprintBanner({
  completedCount,
  total,
}: {
  completedCount: number;
  total: number;
}) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  if (dismissed) return null;

  return (
    <div className="card flex items-center justify-between gap-4 border-[var(--brand-emerald)]/40 bg-[var(--brand-emerald)]/5">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--brand-emerald)]/15">
          <Rocket className="h-4 w-4 text-[var(--brand-emerald)]" />
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">
            Your 14-Day Sprint — {completedCount} of {total} phases done
          </div>
          <div className="text-xs text-muted-foreground">Keep going to reach audit-ready.</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link href="/getting-started" className="btn-primary inline-flex">
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, "1");
            setDismissed(true);
          }}
          className="rounded-md p-2 text-muted-foreground hover:bg-secondary"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
