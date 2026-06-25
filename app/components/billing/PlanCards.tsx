"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { startCheckout, openBillingPortal } from "@/app/actions/billing";
import { useToast } from "@/components/ui/Toast";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

const PLAN_UI = [
  {
    key: "starter",
    name: "Starter",
    price: "€249",
    priceAnnual: "€2,988",
    features: [
      "Up to 2 frameworks",
      "Evidence vault",
      "Monitoring & alerts",
      "AI Policy Generator",
      "AI Co-Pilot",
    ],
  },
  {
    key: "growth",
    name: "Growth",
    price: "€599",
    priceAnnual: "€7,188",
    features: [
      "Everything in Starter",
      "Google Workspace integration",
      "Vendor risk management",
      "Public Trust Center",
      "Priority support",
    ],
  },
] as const;

// Friendly labels for raw Stripe statuses (past_due etc. read like an error code).
const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Payment issue",
  unpaid: "Payment issue",
  incomplete: "Payment incomplete",
  incomplete_expired: "Payment expired",
  canceled: "Canceled",
};

export function PlanCards({
  currentPlan,
  subscriptionStatus,
  stripeEnabled,
}: {
  currentPlan: "starter" | "growth" | null;
  subscriptionStatus: string | null;
  stripeEnabled: boolean;
}) {
  const toast = useToast();
  const params = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [cycle, setCycle] = useState<"month" | "year">("month");
  const justSucceeded = params.get("status") === "success";

  async function subscribe(plan: string) {
    setBusy(plan);
    const res = await startCheckout(plan, cycle);
    if (res?.error) {
      toast("error", res.error);
      setBusy(null);
      return;
    }
    if (res?.url) window.location.href = res.url;
  }

  async function managePortal() {
    setBusy("portal");
    const res = await openBillingPortal();
    if (res?.error) {
      toast("error", res.error);
      setBusy(null);
      return;
    }
    if (res?.url) window.location.href = res.url;
  }

  return (
    <div className="space-y-4">
      {justSucceeded && (
        <div className="rounded-md border border-[var(--brand-emerald)]/40 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Payment received — your subscription activates as soon as Stripe confirms it
          (usually a few seconds). Refresh if you don&apos;t see it yet.
        </div>
      )}

      {currentPlan &&
        ["past_due", "unpaid", "incomplete", "incomplete_expired"].includes(
          subscriptionStatus ?? "",
        ) && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            There&apos;s a payment issue with your subscription — open the billing portal to update
            your card before access is interrupted.
          </div>
        )}

      {currentPlan && (
        <div className="card flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">
              Current plan: {currentPlan === "starter" ? "Starter" : "Growth"}
            </div>
            <div className="text-xs text-muted-foreground">
              Status: {STATUS_LABELS[subscriptionStatus ?? ""] ?? subscriptionStatus}
            </div>
          </div>
          <button
            onClick={managePortal}
            disabled={busy !== null || !stripeEnabled}
            className="btn-outline"
          >
            {busy === "portal" ? "Opening..." : "Manage subscription"}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          value={cycle}
          onChange={setCycle}
          options={[
            { value: "month", label: "Monthly" },
            { value: "year", label: "Annual" },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          Have a founder code? Enter it at checkout for your discount.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {PLAN_UI.map((p) => {
          const isCurrent = currentPlan === p.key;
          // When on Starter and clicking Growth, open the portal so Stripe
          // handles the upgrade/proration — no second checkout needed.
          const isUpgrade = currentPlan === "starter" && p.key === "growth";

          function handleClick() {
            if (isUpgrade) {
              managePortal();
            } else {
              subscribe(p.key);
            }
          }

          function buttonLabel() {
            if (isCurrent) return "Current plan";
            if (busy === p.key || (isUpgrade && busy === "portal")) return "Redirecting...";
            if (isUpgrade) return "Upgrade to Growth";
            return `Choose ${p.name}`;
          }

          return (
            <div
              key={p.key}
              className={`card space-y-4 ${p.key === "growth" ? "border-[var(--brand-emerald)]" : ""}`}
            >
              <div>
                <h2 className="text-lg font-semibold text-foreground">{p.name}</h2>
                <div className="mt-1">
                  <span className="text-3xl font-bold text-foreground">
                    {cycle === "year" ? p.priceAnnual : p.price}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {cycle === "year" ? " / year" : " / month"}
                  </span>
                </div>
              </div>
              <ul className="space-y-2">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-foreground">
                    <Check className="h-4 w-4 shrink-0 text-[var(--brand-emerald)]" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={handleClick}
                disabled={busy !== null || !stripeEnabled || isCurrent}
                className={p.key === "growth" ? "btn-accent w-full" : "btn-primary w-full"}
              >
                {buttonLabel()}
              </button>
            </div>
          );
        })}

        {/* Enterprise — custom pricing per the PRD, so it's a contact-sales card, not Stripe. */}
        <div className="card space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Enterprise</h2>
            <div className="mt-1">
              <span className="text-3xl font-bold text-foreground">Custom</span>
            </div>
          </div>
          <ul className="space-y-2">
            {[
              "Everything in Growth",
              "Unlimited frameworks",
              "SSO / SAML (on request)",
              "Dedicated onboarding & support",
              "Custom contract & DPA",
            ].map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm text-foreground">
                <Check className="h-4 w-4 shrink-0 text-[var(--brand-emerald)]" />
                {f}
              </li>
            ))}
          </ul>
          <a
            href="mailto:sales@shieldflow.com?subject=ShieldFlow%20Enterprise%20enquiry"
            className="btn-outline w-full"
          >
            Contact sales
          </a>
        </div>
      </div>
    </div>
  );
}
