/**
 * Cross-referencing memory of joint operations: every joint operation is written into the operation
 * database with the app that did the work, so a future similar operation recalls what worked (and
 * what failed) on which app and app selection can prefer it.
 */
import { emptyTally, type AppDecision, type AppTally } from './app-selection.js';
import type { OperationRecord } from './operation-db.js';
import type { OperationDraft } from './operation-log.js';
import { similarOperation } from './operation-memory.js';
import type { JointApp } from './main-bridge-protocol.js';

/** Op name of a joint operation's record. */
export const JOINT_OP = 'joint';
/** Most recalled records given as context. */
export const RECALL_LIMIT = 5;

/** A finished half of a joint operation: which app did it, in which role, and how it ended. */
export interface JointOutcome {
  operation: string;
  app: JointApp;
  role: 'calculate' | 'perform';
  ok: boolean;
  output: string;
}

/** The operation draft of one joint outcome, attributed to its app. */
export function jointDraft(o: JointOutcome, d: AppDecision): OperationDraft {
  return { category: 'track', op: JOINT_OP, element: o.operation, input: `${o.role} on ${o.app} (${d.mode}) — ${d.reason}`, output: o.output, ok: o.ok, app: o.app };
}

/** Attributed records of operations similar to `operation`, newest first. */
export const recallSimilar = (records: readonly OperationRecord[], operation: string): OperationRecord[] =>
  records.filter((r) => r.app && similarOperation(r.element ?? r.input, operation)).sort((a, b) => b.time - a.time);

/** How often similar operations worked or failed on each app. */
export function appTally(records: readonly OperationRecord[], operation: string): AppTally {
  const tally = emptyTally();
  for (const r of recallSimilar(records, operation)) tally[r.app!][r.ok ? 'ok' : 'failed'] += 1;
  return tally;
}

/** Context lines of what worked on which app for similar operations. */
export const recallLines = (records: readonly OperationRecord[], operation: string): string[] =>
  recallSimilar(records, operation).slice(0, RECALL_LIMIT).map((r) => `[${r.app} ${r.ok ? 'worked' : 'failed'}] ${r.element ?? r.op}: ${r.output}`);
