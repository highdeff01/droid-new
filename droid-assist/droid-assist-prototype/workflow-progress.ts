import type { WorkflowStep } from './types.js';

/** Per-step checkoff progress toward the goal: steps verified complete on the live frame out of all steps. */
export interface CheckoffSummary {
  checked: number;
  total: number;
  /** checked / total as a rounded percentage; 0 with no steps. */
  pct: number;
}

/** How many of the workflow's steps are checked off (verified on the live frame). */
export function checkoffSummary(steps: WorkflowStep[]): CheckoffSummary {
  const checked = steps.filter((s) => s.verifiedAt !== undefined).length;
  return { checked, total: steps.length, pct: steps.length ? Math.round((checked * 100) / steps.length) : 0 };
}

/** The Workflow panel's progress line: "n/m checked off (pct%)". */
export const checkoffText = (s: CheckoffSummary) => `${s.checked}/${s.total} checked off (${s.pct}%)`;
