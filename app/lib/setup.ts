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
/** Share of mandatory measures that must be started for the "review" phase. */
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

/** The minimal measure shape (a structural subset of MeasureWithStatus). */
export interface SprintMeasure {
  status: ControlStatus;
  importance: "mandatory" | "preferred" | "advanced";
}

export interface SprintInput {
  connectedIntegrations: number;
  /** Still used for the headline score — the number people recognise. */
  controls: SprintControl[];
  /** What the work phases are actually measured against. See computeSprint. */
  measures: SprintMeasure[];
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

/**
 * The work phases count MEASURES, not controls.
 *
 * They used to count controls, which was fine at 15 per framework. At 328 across
 * eight frameworks it meant ~101 individual clicks to clear phase 2 for a
 * SOC 2 + ISO 27001 workspace — the single biggest reason the product felt slow.
 * The measure layer exists precisely so nobody does that: 64 mandatory measures
 * cover all 328 requirements, and completing one advances every control it
 * satisfies. Integration checks complete some of them outright (see
 * lib/measures.ts), so connecting your stack moves the bar on its own.
 *
 * The headline score still reads off controls — it is the number a user
 * recognises and the one an auditor asks about.
 */
export function computeSprint(input: SprintInput): SprintResult {
  const { connectedIntegrations, controls, measures, approvedPolicies } = input;

  const mandatory = measures.filter((m) => m.importance === "mandatory");
  const total = mandatory.length;
  const touched = mandatory.filter((m) => m.status !== "not_started").length;
  const mandatoryComplete = mandatory.filter((m) => m.status === "complete").length;
  const score = computeScore(controls.map((c) => c.status));

  const connectDone = connectedIntegrations >= CONNECT_TARGET;
  const reviewDone = total > 0 && touched / total >= REVIEW_THRESHOLD;
  // Guard total so an empty set can't read as vacuously "done".
  const coreDone = total > 0 && mandatoryComplete === total;
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
      title: "Work through your measures",
      blurb:
        "One measure satisfies requirements across every framework you run — so this is the short list, not the long one.",
      done: reviewDone,
      progressLabel: total === 0 ? "No measures yet" : `${touched} of ${total} started`,
      ctaLabel: "Open measures",
      ctaHref: "/measures",
    },
    {
      key: "core",
      title: "Finish the mandatory measures",
      blurb:
        "The ones an audit will actually fail you on. Anything your connected integrations already prove is ticked for you.",
      done: coreDone,
      progressLabel:
        total === 0 ? "No measures yet" : `${mandatoryComplete} of ${total} mandatory done`,
      ctaLabel: "Close the gaps",
      ctaHref: "/measures",
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
