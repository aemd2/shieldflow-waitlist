export type ControlStatus = "not_started" | "in_progress" | "complete";

export interface StatusCounts {
  not_started: number;
  in_progress: number;
  complete: number;
}

export function countStatuses(statuses: ControlStatus[]): StatusCounts {
  return statuses.reduce<StatusCounts>(
    (acc, s) => {
      acc[s] += 1;
      return acc;
    },
    { not_started: 0, in_progress: 0, complete: 0 },
  );
}

/**
 * Compliance score: percent complete + half-credit for in-progress.
 * Returns an integer 0-100.
 */
export function computeScore(statuses: ControlStatus[]): number {
  if (statuses.length === 0) return 0;
  return computeScoreFromCounts(countStatuses(statuses));
}

export function computeScoreFromCounts(counts: StatusCounts): number {
  const total = counts.not_started + counts.in_progress + counts.complete;
  if (total === 0) return 0;
  const weighted = counts.complete + counts.in_progress * 0.5;
  return Math.round((weighted / total) * 100);
}
