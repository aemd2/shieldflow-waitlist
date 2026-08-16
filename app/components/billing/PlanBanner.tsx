import Link from "next/link";
import { Sparkles, Clock, Lock } from "lucide-react";
import type { CompanyPlan } from "@/lib/plan-server";

/**
 * Thin strip under the topbar telling a workspace where it stands: how much of
 * the Tester trial is left, or that it has lapsed to Free. Renders nothing for
 * paying customers — they don't need a permanent banner.
 */
export function PlanBanner({ plan }: { plan: CompanyPlan }) {
  if (plan.plan === "tester" && plan.daysLeft !== null) {
    // The last stretch is the one that converts, so it gets the urgent styling.
    const urgent = plan.daysLeft <= 3;
    const cls = urgent
      ? "border-warning-border bg-warning-muted text-warning"
      : "border-[var(--brand-emerald)]/45 bg-[var(--brand-emerald)]/[0.07] text-foreground";

    return (
      <div
        className={`flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-6 py-2 text-xs print:hidden ${cls}`}
      >
        {urgent ? <Clock className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
        <span>
          <strong>
            {plan.daysLeft} day{plan.daysLeft === 1 ? "" : "s"} left
          </strong>{" "}
          of your full-access trial. After that this workspace moves to the Free plan — your data
          stays put.
        </span>
        <Link href="/billing" className="font-semibold underline underline-offset-2">
          See plans
        </Link>
      </div>
    );
  }

  if (plan.trialExpired) {
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-warning-border bg-warning-muted px-6 py-2 text-xs text-warning print:hidden">
        <Lock className="h-3.5 w-3.5" />
        <span>
          Your trial has ended — this workspace is on the <strong>Free plan</strong>. Integrations,
          AI and the Trust Center are paused; everything you created is still here.
        </span>
        <Link href="/billing" className="font-semibold underline underline-offset-2">
          Upgrade to restore
        </Link>
      </div>
    );
  }

  return null;
}
