import type { WorkflowStep } from './types.js';
import { agreementState, type StepAgreement, type StepAgreementState, type StepOwner } from './takeover.js';

/** One step of the AI's output: planned, then dispatched (to which app), then verified. */
export interface CoordinationRow {
  index: number;
  name: string;
  planned: true;
  dispatched: boolean;
  owner: StepOwner;
  verified: boolean | null;
  state: StepAgreementState;
}

/** Counts of the AI's output at each stage. */
export interface CoordinationTotals {
  planned: number;
  dispatched: number;
  verified: number;
  complete: number;
}

const DISPATCHED: ReadonlySet<WorkflowStep['status']> = new Set(['running', 'done', 'drift', 'failed']);

/** The planned-vs-dispatched-vs-verified row of every planned step. */
export function coordinationRows(steps: readonly WorkflowStep[], agreements: readonly StepAgreement[]): CoordinationRow[] {
  return steps.map((s, index) => {
    const a = agreements.find((x) => x.index === index);
    return {
      index,
      name: s.name,
      planned: true,
      dispatched: DISPATCHED.has(s.status) || !!a,
      owner: a?.owner ?? 'assist',
      verified: a?.verified ?? (s.status === 'failed' ? false : null),
      state: a ? agreementState(a) : 'unverified',
    };
  });
}

/** The totals of the rows. */
export const coordinationTotals = (rows: readonly CoordinationRow[]): CoordinationTotals => ({
  planned: rows.length,
  dispatched: rows.filter((r) => r.dispatched).length,
  verified: rows.filter((r) => r.verified === true).length,
  complete: rows.filter((r) => r.state === 'complete').length,
});

/** One request flowing between the apps: a user request typed in one, carried to the other. */
export interface RequestFlow {
  time: number;
  direction: 'to-main' | 'from-main';
  text: string;
}

/** Most request flows kept (newest first). */
export const FLOW_LIMIT = 50;

/** Prepends a flow, capped. */
export const pushFlow = (list: readonly RequestFlow[], flow: RequestFlow): RequestFlow[] => [flow, ...list].slice(0, FLOW_LIMIT);
