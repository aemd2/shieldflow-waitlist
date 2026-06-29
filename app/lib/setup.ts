import { computeScore, type ControlStatus } from "@/lib/score";
import type { Criticality } from "@/lib/db/queries";

/**
 * The 14-Day Sprint engine. Pure + derived: it reads only data that already
 * exists (connected integrations, control statuses, approved policies) and never
 * persists a "phase" of its own, so progress can never drift from reality.
 * Phases gate on thresholds, not calendar days — identical UX for 20 or 500
 * controls. Mirrors lib/score.ts: no DB, no side effects, trivially testable.
 */

/** Minimum connected integrations for the "connect" phase to count as done. */
export const CONNECT_TARGET = 1;
/** Share of controls that must be off "not_started" for the "review" phase to be done. */
export const REVIEW_THRESHOLD = 0.8;

export type SprintPhaseKey = "connect" | "review" | "core" | "documents";

export interface SprintPhase {
  key: SprintPhaseKey;
  title: string;
  blurb: string;
  done: boolean;
  progressLabel: string;
  ctaLabel: string;
  ctaHref: string;
}

/** The minimal control shape the engine needs (a structural subset of ControlWithStatus). */
export interface SprintControl {
  status: ControlStatus;
  criticality: Criticality;
}

export interface SprintInput {
  connectedIntegrations: number;
  controls: SprintControl[];
  approvedPolicies: number;
}

export interface SprintResult {
  phases: SprintPhase[];
  /** Index of the first not-done phase; equals phases.length when audit-ready. */
  currentIndex: number;
  completedCount: number;
  ready: boolean;
  /** Overall compliance score (reused from lib/score), for display only. */
  score: number;
}

export function computeSprint(input: SprintInput): SprintResult {
  const { connectedIntegrations, controls, approvedPolicies } = input;

  const total = controls.length;
  const touched = controls.filter((c) => c.status !== "not_started").length;
  const core = controls.filter((c) => c.criticality === "core");
  const coreComplete = core.filter((c) => c.status === "complete").length;
  const score = computeScore(controls.map((c) => c.status));

  const connectDone = connectedIntegrations >= CONNECT_TARGET;
  const reviewDone = total > 0 && touched / total >= REVIEW_THRESHOLD;
  // Guard core.length so an empty set can't read as vacuously "done".
  const coreDone = core.length > 0 && coreComplete === core.length;
  const documentsDone = approvedPolicies >= 1;

  const phases: SprintPhase[] = [
    {
      key: "connect",
      title: "Connect your stack",
      blurb:
        "Link your cloud, identity, and source-control tools so evidence collects itself.",
      done: connectDone,
      progressLabel:
        connectedIntegrations === 0 ? "Nothing connected yet" : `${connectedIntegrations} connected`,
      ctaLabel: connectDone ? "Manage integrations" : "Connect integrations",
      ctaHref: "/integrations",
    },
    {
      key: "review",
      title: "Review your controls",
      blurb:
        "Walk each control and mark it in-progress or complete as you put it in place.",
      done: reviewDone,
      progressLabel: total === 0 ? "No controls yet" : `${touched} of ${total} reviewed`,
      ctaLabel: "Open controls",
      ctaHref: "/dashboard",
    },
    {
      key: "core",
      title: "Close the core gaps",
      blurb:
        "Finish the auditor-critical controls first — the ones an audit will fail you on.",
      done: coreDone,
      progressLabel:
        core.length === 0 ? "No core controls" : `${coreComplete} of ${core.length} core controls`,
      ctaLabel: "Close core gaps",
      ctaHref: "/dashboard",
    },
    {
      key: "documents",
      title: "Document & sign off",
      blurb: "Generate, approve, and publish the policies your auditor will ask for.",
      done: documentsDone,
      progressLabel: approvedPolicies === 0 ? "No approved policies" : `${approvedPolicies} approved`,
      ctaLabel: "Review policies",
      ctaHref: "/policies",
    },
  ];

  const completedCount = phases.filter((p) => p.done).length;
  const firstNotDone = phases.findIndex((p) => !p.done);
  const ready = firstNotDone === -1;
  const currentIndex = ready ? phases.length : firstNotDone;

  return { phases, currentIndex, completedCount, ready, score };
}
