import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCompanyForUser,
  getControlsWithStatus,
  listFrameworks,
  listSelectedFrameworkIds,
  listVendors,
  listRisks,
  listTraining,
  getControlChecks,
  listTasks,
  listPolicies,
  listPolicyAcknowledgements,
  getCompanyMemberCount,
  listIntegrations,
  getCallerAccess,
  type Integration,
} from "@/lib/db/queries";
import { computeScore, countStatuses } from "@/lib/score";
import { computeSprint } from "@/lib/setup";
import { computeAlerts } from "@/lib/monitoring";
import { ScoreCard } from "@/components/dashboard/ScoreCard";
import { AlertsPanel } from "@/components/dashboard/AlertsPanel";
import { ControlsExplorer } from "@/components/dashboard/ControlsExplorer";
import { SprintBanner } from "@/components/setup/SprintBanner";
import { PageShell } from "@/components/ui/page";

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const company = await getCompanyForUser(supabase, user.id);
  if (!company) redirect("/onboarding");

  const [controls, allFrameworks, selectedIds, vendors, risks, training, checks, tasks, policies, policyAcks, memberCount, integrations, access] =
    await Promise.all([
      getControlsWithStatus(supabase, company.id),
      listFrameworks(supabase),
      listSelectedFrameworkIds(supabase, company.id),
      listVendors(supabase, company.id),
      listRisks(supabase, company.id),
      listTraining(supabase, company.id),
      getControlChecks(supabase, company.id),
      listTasks(supabase, company.id),
      listPolicies(supabase, company.id),
      listPolicyAcknowledgements(supabase, company.id),
      getCompanyMemberCount(supabase, company.id),
      listIntegrations(supabase, company.id).catch(() => [] as Integration[]),
      getCallerAccess(supabase, company.id, user.id),
    ]);
  const isAuditor = access?.role === "auditor";

  const frameworks = allFrameworks.filter((f) => selectedIds.includes(f.id));

  const statuses = controls.map((c) => c.status);
  const score = computeScore(statuses);
  const counts = countStatuses(statuses);

  // 14-Day Sprint progress — derived live, drives the dashboard nudge banner.
  const sprint = computeSprint({
    connectedIntegrations: integrations.filter((i) => i.status === "connected").length,
    controls,
    approvedPolicies: policies.filter((p) => p.status === "final").length,
  });

  // Per-framework progress (for monitoring rule + display).
  const frameworkProgress = frameworks.map((f) => {
    const subset = controls.filter((c) => c.framework_id === f.id).map((c) => c.status);
    return { name: f.name, pct: computeScore(subset) };
  });

  const alerts = computeAlerts(
    controls,
    frameworkProgress,
    vendors,
    risks,
    training,
    checks,
    tasks,
    policies,
    policyAcks,
    memberCount,
  );

  // Distinct automated checks by key (one posture finding maps to several controls).
  const checkByKey = new Map<string, string>();
  for (const c of checks) checkByKey.set(c.check_key, c.result);
  const checkResults = [...checkByKey.values()];
  const checksPassing = checkResults.filter((r) => r === "pass").length;
  const checksFailing = checkResults.filter((r) => r === "fail").length;
  const checksInconclusive = checkResults.filter((r) => r === "inconclusive").length;

  // Per-control health for the list rows: a failing check wins (most important to
  // surface), then passing, then inconclusive. Controls with no checks are absent.
  const controlHealth: Record<string, "pass" | "fail" | "inconclusive"> = {};
  for (const ch of checks) {
    const cur = controlHealth[ch.control_id];
    if (ch.result === "fail") controlHealth[ch.control_id] = "fail";
    else if (ch.result === "pass") {
      if (cur !== "fail") controlHealth[ch.control_id] = "pass";
    } else if (!cur) {
      controlHealth[ch.control_id] = "inconclusive";
    }
  }

  return (
    <PageShell
      layout="overview"
      banner={
        !sprint.ready && !isAuditor ? (
          <SprintBanner completedCount={sprint.completedCount} total={sprint.phases.length} />
        ) : undefined
      }
      title="Compliance dashboard"
      subtitle={`Overview of ${company.name}'s controls.`}
    >
      <div className="grid gap-4 md:grid-cols-4">
        <ScoreCard score={score} />
        <StatCard label="Complete" value={counts.complete} color="emerald" />
        <StatCard label="In progress" value={counts.in_progress} color="amber" />
        <StatCard label="Not started" value={counts.not_started} color="muted" />
      </div>

      {frameworkProgress.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {frameworkProgress.map((fp) => (
            <div key={fp.name} className="card">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{fp.name}</span>
                <span className="text-muted-foreground">{fp.pct}%</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-[var(--brand-emerald)] transition-all"
                  style={{ width: `${fp.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {checkResults.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Automated monitoring</h2>
            <span className="text-xs text-muted-foreground">
              {checkResults.length} {checkResults.length === 1 ? "check" : "checks"} from connected integrations
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <span className="font-medium text-[var(--brand-emerald)]">{checksPassing} passing</span>
            <span className="font-medium text-destructive">{checksFailing} failing</span>
            <span className="font-medium text-muted-foreground">{checksInconclusive} inconclusive</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Checks are evaluated each time you sync an integration and mapped to your controls. Failing checks appear in Monitoring &amp; alerts and on each control.
          </p>
        </div>
      )}

      <AlertsPanel alerts={alerts} />

      <ControlsExplorer controls={controls} frameworks={frameworks} health={controlHealth} />
    </PageShell>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "emerald" | "amber" | "muted";
}) {
  const colorClass = {
    emerald: "text-[var(--brand-emerald)]",
    amber: "text-amber-600",
    muted: "text-muted-foreground",
  }[color];
  return (
    <div className="card">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`mt-2 text-3xl font-semibold ${colorClass}`}>{value}</div>
    </div>
  );
}
