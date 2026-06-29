import type {
  ControlWithStatus,
  Vendor,
  Risk,
  TrainingRecord,
  ControlCheck,
  Task,
  Policy,
  PolicyAck,
} from "@/lib/db/queries";

export type AlertSeverity = "high" | "warning" | "info";

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  controlId?: string;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { high: 0, warning: 1, info: 2 };

/**
 * Rule-based, live-computed alerts. Pure function of the data already loaded for
 * the dashboard — no extra queries, no stored state, so it can never go stale.
 */
export function computeAlerts(
  controls: ControlWithStatus[],
  frameworkProgress: { name: string; pct: number }[] = [],
  vendors: Vendor[] = [],
  risks: Risk[] = [],
  training: TrainingRecord[] = [],
  checks: ControlCheck[] = [],
  tasks: Task[] = [],
  policies: Policy[] = [],
  policyAcks: PolicyAck[] = [],
  memberCount = 0,
): Alert[] {
  const alerts: Alert[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Failing automated checks (continuous monitoring). One posture finding (e.g.
  // root MFA off) maps to several controls, so dedupe by the failing check itself
  // and deep-link to a representative control.
  const seenCheck = new Set<string>();
  for (const c of checks) {
    if (c.result !== "fail") continue;
    const key = `${c.check_key}|${c.detail ?? ""}`;
    if (seenCheck.has(key)) continue;
    seenCheck.add(key);
    alerts.push({
      id: `check-fail-${c.check_key}`,
      severity: "warning",
      title: "Automated check failing",
      detail: c.detail ?? `${c.check_key} is failing.`,
      controlId: c.control_id,
    });
  }

  for (const c of controls) {
    // Marked complete but no evidence attached.
    if (c.status === "complete" && c.evidenceCount === 0) {
      alerts.push({
        id: `no-evidence-${c.id}`,
        severity: "warning",
        title: "Completed without evidence",
        detail: `${c.code} · ${c.title} is marked complete but has no evidence attached.`,
        controlId: c.id,
      });
    }

    // Past due and not yet complete.
    if (c.status !== "complete" && c.due_date) {
      const due = new Date(c.due_date);
      due.setHours(0, 0, 0, 0);
      if (due < today) {
        alerts.push({
          id: `overdue-${c.id}`,
          severity: "high",
          title: "Overdue control",
          detail: `${c.code} · ${c.title} was due ${c.due_date} and is still ${labelStatus(c.status)}.`,
          controlId: c.id,
        });
      }
    }
  }

  // Whole framework below target.
  for (const fp of frameworkProgress) {
    if (fp.pct < 50) {
      alerts.push({
        id: `framework-low-${fp.name}`,
        severity: "info",
        title: "Framework below target",
        detail: `${fp.name} is at ${fp.pct}% — below the 50% readiness target.`,
      });
    }
  }

  // Vendors needing attention.
  for (const v of vendors) {
    if (v.status === "under_review") {
      alerts.push({
        id: `vendor-review-${v.id}`,
        severity: "warning",
        title: "Vendor under review",
        detail: `${v.name} is under review — finish the assessment and set a risk level.`,
      });
    } else if (v.status === "active" && (v.risk_level === "high" || v.risk_level === "critical")) {
      alerts.push({
        id: `vendor-risk-${v.id}`,
        severity: v.risk_level === "critical" ? "high" : "warning",
        title: `${v.risk_level === "critical" ? "Critical" : "High"}-risk vendor active`,
        detail: `${v.name} is active with ${v.risk_level} risk — consider mitigations or review.`,
      });
    }

    // Review cadence + SOC 2 freshness (offboarded vendors don't need either).
    if (v.status !== "offboarded") {
      if (v.reviewed_at && v.review_cadence_months) {
        const next = new Date(v.reviewed_at);
        next.setMonth(next.getMonth() + v.review_cadence_months);
        if (next < today) {
          alerts.push({
            id: `vendor-cadence-${v.id}`,
            severity: "warning",
            title: "Vendor review overdue",
            detail: `${v.name} was last reviewed ${v.reviewed_at}, past its ${v.review_cadence_months}-month cadence.`,
          });
        }
      }
      if (v.soc2_status === "on_file" && v.soc2_expires_at && new Date(v.soc2_expires_at) < today) {
        alerts.push({
          id: `vendor-soc2-${v.id}`,
          severity: "warning",
          title: "Vendor SOC 2 expired",
          detail: `${v.name}'s SOC 2 report expired ${v.soc2_expires_at} — request a current report.`,
        });
      }
    }
  }

  // Risks needing attention. Use the residual (post-mitigation) score when it's
  // been assessed, otherwise the inherent score — so linked, mitigated controls
  // actually lower the alerting level.
  for (const r of risks) {
    if (r.status === "closed" || r.status === "accepted") continue;
    const lk = r.residual_likelihood ?? r.likelihood;
    const im = r.residual_impact ?? r.impact;
    if (lk === "high" && im === "high") {
      alerts.push({
        id: `risk-critical-${r.id}`,
        severity: "high",
        title: "Critical risk open",
        detail: `"${r.title}" is high likelihood and high impact — prioritise treatment.`,
      });
    } else if (r.status === "open" && (lk === "high" || im === "high")) {
      alerts.push({
        id: `risk-elevated-${r.id}`,
        severity: "warning",
        title: "Elevated risk open",
        detail: `"${r.title}" has elevated risk and no mitigation in progress yet.`,
      });
    }
  }

  // Employee training overdue (aggregated so one late cohort isn't a wall of alerts).
  const overdueTraining = training.filter(
    (t) => t.status !== "completed" && t.due_date && new Date(t.due_date) < today,
  );
  if (overdueTraining.length > 0) {
    alerts.push({
      id: "training-overdue",
      severity: "warning",
      title: "Training overdue",
      detail: `${overdueTraining.length} training assignment${overdueTraining.length > 1 ? "s are" : " is"} past due.`,
    });
  }

  // Tasks overdue (aggregated, like training, so a stale backlog isn't a wall).
  const overdueTasks = tasks.filter(
    (t) => t.status !== "done" && t.due_date && new Date(t.due_date) < today,
  );
  if (overdueTasks.length > 0) {
    alerts.push({
      id: "tasks-overdue",
      severity: "warning",
      title: "Tasks overdue",
      detail: `${overdueTasks.length} task${overdueTasks.length > 1 ? "s are" : " is"} past due.`,
    });
  }

  // Published policies awaiting full acknowledgement, and policies due for review.
  for (const p of policies) {
    if (!p.published_at) continue;
    const acked = policyAcks.filter((a) => a.policy_id === p.id && a.version === p.version).length;
    if (memberCount > 0 && acked < memberCount) {
      alerts.push({
        id: `policy-ack-${p.id}`,
        severity: "info",
        title: "Policy awaiting acknowledgement",
        detail: `${acked} of ${memberCount} acknowledged "${p.title}".`,
      });
    }
    if (p.review_cadence_months) {
      const due = new Date(p.published_at);
      due.setMonth(due.getMonth() + p.review_cadence_months);
      if (due < today) {
        alerts.push({
          id: `policy-review-${p.id}`,
          severity: "warning",
          title: "Policy due for review",
          detail: `"${p.title}" has passed its ${p.review_cadence_months}-month review cadence.`,
        });
      }
    }
  }

  // Predictive: controls due in the next 14 days (not complete).
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 14);
  const dueSoon = controls.filter((c) => {
    if (c.status === "complete" || !c.due_date) return false;
    const due = new Date(c.due_date);
    due.setHours(0, 0, 0, 0);
    return due >= today && due <= horizon;
  }).length;
  if (dueSoon > 0) {
    alerts.push({
      id: "predict-due-soon",
      severity: "info",
      title: "Deadlines approaching",
      detail: `${dueSoon} control${dueSoon > 1 ? "s are" : " is"} due in the next 14 days.`,
    });
  }

  // Predictive: readiness pace — flag if a lot is untouched and overall is low.
  if (controls.length > 0) {
    const notStarted = controls.filter((c) => c.status === "not_started").length;
    const points = controls.reduce(
      (sum, c) => sum + (c.status === "complete" ? 1 : c.status === "in_progress" ? 0.5 : 0),
      0,
    );
    const pct = Math.round((points / controls.length) * 100);
    if (pct < 50 && notStarted / controls.length > 0.4) {
      alerts.push({
        id: "predict-pace",
        severity: "info",
        title: "Behind on readiness",
        detail: `At ${pct}% with ${notStarted} controls not started — at the current pace you may miss your target. Assign owners and due dates to accelerate.`,
      });
    }
  }

  return alerts.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

function labelStatus(s: string): string {
  return s === "in_progress" ? "in progress" : "not started";
}
