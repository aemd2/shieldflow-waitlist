"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Sparkles, Lock } from "lucide-react";
import { startCheckout, openBillingPortal } from "@/app/actions/billing";
import { useToast } from "@/components/ui/Toast";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  applyFoundingDiscount,
  foundingTierLabel,
  FOUNDING_TIER_SIZE,
  type FoundingTier,
} from "@/lib/founding";

const PLAN_UI = [
  {
    key: "starter",
    name: "Starter",
    monthly: 249,
    annual: 2988,
    blurb: "Get your first framework audit-ready.",
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
    monthly: 599,
    annual: 7188,
    popular: true,
    blurb: "For scaling teams that need integrations.",
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

function eur(n: number): string {
  return n.toLocaleString("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function PlanCards({
  currentPlan,
  subscriptionStatus,
  stripeEnabled,
  founding,
}: {
  currentPlan: "starter" | "growth" | null;
  subscriptionStatus: string | null;
  stripeEnabled: boolean;
  founding: FoundingTier | null;
}) {
  const toast = useToast();
  const params = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [cycle, setCycle] = useState<"month" | "year">("month");
  const justSucceeded = params.get("status") === "success";
  const discount = founding && founding.percent > 0 ? founding : null;

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
    <div className="space-y-5">
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

      {/* Current plan — the primary thing an existing customer comes here for. */}
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

      {/* Founding-cohort offer — only pitched to companies without a plan yet. */}
      {discount && (
        <div className="card border-[var(--brand-emerald)]/45 bg-[var(--brand-emerald)]/[0.07]">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-emerald)]/15 text-[var(--brand-emerald)]">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  Founding offer — {discount.percent}% off, locked for life
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-emerald)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--brand-emerald)]">
                  <Lock className="h-3 w-3" /> Forever
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                You&apos;re in {foundingTierLabel(discount.tierIndex)} companies to join, so you get{" "}
                <span className="font-medium text-foreground">{discount.percent}% off any plan</span>{" "}
                for as long as you stay — applied automatically at checkout.{" "}
                <span className="font-medium text-foreground">
                  {discount.spotsLeftInTier} of {FOUNDING_TIER_SIZE} spots left at this rate.
                </span>
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={cycle}
          onChange={setCycle}
          options={[
            { value: "month", label: "Monthly" },
            { value: "year", label: "Annual" },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          {discount
            ? `Your ${discount.percent}% founding discount is applied automatically.`
            : "Cancel anytime from the billing portal."}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PLAN_UI.map((p) => {
          const isCurrent = currentPlan === p.key;
          // When on Starter and clicking Growth, open the portal so Stripe
          // handles the upgrade/proration — no second checkout needed.
          const isUpgrade = currentPlan === "starter" && p.key === "growth";
          const base = cycle === "year" ? p.annual : p.monthly;
          const final = discount ? applyFoundingDiscount(base, discount.percent) : base;

          function handleClick() {
            if (isUpgrade) managePortal();
            else subscribe(p.key);
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
              className={`card relative flex flex-col ${
                "popular" in p && p.popular ? "border-[var(--brand-emerald)] shadow-[var(--shadow-md)]" : ""
              }`}
            >
              {"popular" in p && p.popular && (
                <span className="absolute -top-2.5 right-4 rounded-full bg-[var(--brand-emerald)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--accent-foreground)]">
                  Most popular
                </span>
              )}

              <h2 className="text-base font-semibold text-foreground">{p.name}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{p.blurb}</p>

              <div className="mt-3 flex items-baseline gap-2">
                {discount && (
                  <span className="text-base font-medium text-muted-foreground line-through">
                    {eur(base)}
                  </span>
                )}
                <span className="text-3xl font-bold text-foreground">{eur(final)}</span>
                <span className="text-sm text-muted-foreground">
                  {cycle === "year" ? "/ year" : "/ month"}
                </span>
              </div>
              {discount && (
                <div className="mt-1 text-xs font-medium text-[var(--brand-emerald)]">
                  {discount.percent}% founding discount applied · locked for life
                </div>
              )}

              <ul className="mt-4 flex-1 space-y-2">
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
                className={`mt-5 ${
                  "popular" in p && p.popular ? "btn-accent" : "btn-primary"
                } w-full`}
              >
                {buttonLabel()}
              </button>
            </div>
          );
        })}

        {/* Custom — bespoke scope, so it's a talk-to-us card, not Stripe checkout. */}
        <div className="card flex flex-col">
          <h2 className="text-base font-semibold text-foreground">Custom</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Tailored to your team, frameworks, and contract.
          </p>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-foreground">Let&apos;s talk</span>
          </div>
          <ul className="mt-4 flex-1 space-y-2">
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
            href="mailto:sales@shieldflow.com?subject=ShieldFlow%20custom%20plan%20enquiry"
            className="btn-outline mt-5 w-full"
          >
            Contact us
          </a>
        </div>
      </div>
    </div>
  );
}
