import type { StepStatus, WorkflowStep } from './types.js';

/** How often the automatic main retry looks for failed or drifted steps. */
export const AUTO_RETRY_TICK_MS = 2000;
/** Log source and run label of the automatic main retry. */
export const AUTO_RETRY_LABEL = 'Main retry';

/** Step statuses the main retry re-runs on its own. */
const RETRY_STATUSES: ReadonlySet<StepStatus> = new Set<StepStatus>(['failed', 'drift']);

/** Automatic attempts made so far, by step id. */
export type RetryCounts = ReadonlyMap<string, number>;

/** Indices of the failed or drifted steps that still have automatic attempts left (fewer than `limit`). */
export function retryDue(steps: WorkflowStep[], counts: RetryCounts, limit: number): number[] {
  return steps.flatMap((s, i) => (RETRY_STATUSES.has(s.status) && (counts.get(s.id) ?? 0) < limit ? [i] : []));
}

/** The counts with one more attempt for each of `ids`. */
export function countAttempts(counts: RetryCounts, ids: string[]): Map<string, number> {
  const next = new Map(counts);
  for (const id of ids) next.set(id, (next.get(id) ?? 0) + 1);
  return next;
}

/** The log line announcing an automatic retry of `steps`. */
export function retryText(steps: WorkflowStep[], counts: RetryCounts, limit: number): string {
  const list = steps.map((s) => `"${s.name}" (${s.status}, attempt ${counts.get(s.id) ?? 0}/${limit})`).join(', ');
  return `Re-running ${steps.length} failed/drifted step(s) automatically through the gated pipeline: ${list}`;
}
