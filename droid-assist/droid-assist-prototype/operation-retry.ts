import type { Frame, Habit, WorkflowStep } from './types.js';
import { MATCHED, frameDistance } from './drift.js';
import { anchoredHabit, successRate } from './habits.js';
import type { RunSummary } from './run-stats.js';
import { operationMatch, type SavedOperation } from './saved-operations.js';

/** Range and default of the "retries of a detected operation" setting. */
export const OPERATION_RETRIES_MIN = 0;
export const OPERATION_RETRIES_MAX = 10;
export const DEFAULT_OPERATION_RETRIES = 2;

/** How far back runs count as recently performed. */
export const RECENT_MS = 10 * 60_000;
/** How close a goal or step sequence must be to count as the same operation. */
export const SAME_OPERATION = 0.5;
/** Frame distance above which the screen counts as changed by a run. */
const CHANGED = 0.01;

/** A saved operation recognised as recently performed, and what it was recognised from. */
export interface DetectedOperation {
  op: SavedOperation;
  /** The run summary or steps (a run or playback) it matched. */
  via: 'run' | 'steps';
  time: number;
}

/** How a saved variant of an operation scores for a retry. */
export interface VariantScore {
  op: SavedOperation;
  score: number;
  /** Smoothed success rate of its real runs: (successes + 1) / (runs + 2). */
  runRate: number;
  /** Mean success rate of the habits of its step targets (0.5 when none is known). */
  habitRate: number;
  /** Step targets with a reliable remembered position. */
  anchors: number;
}

const stepKey = (s: WorkflowStep) => `${s.action}:${(s.target ?? s.text ?? '').trim().toLowerCase()}`;

/** Share of `op`'s steps found, in order, in `steps` (0..1). */
export function stepOverlap(op: SavedOperation, steps: WorkflowStep[]): number {
  if (!op.steps.length || !steps.length) return 0;
  const keys = steps.map(stepKey);
  let from = 0;
  let hits = 0;
  for (const k of op.steps.map(stepKey)) {
    const at = keys.indexOf(k, from);
    if (at >= 0) {
      hits++;
      from = at + 1;
    }
  }
  return hits / op.steps.length;
}

/** Whether a run summary is a run of `op`: attributed to it, or with the same goal. */
const runOf = (op: SavedOperation, r: RunSummary) => r.flowId === op.id || (!!r.goal && operationMatch(r.goal, op) >= SAME_OPERATION);

/**
 * The saved operations recently performed, newest first: those with a run summary in the last
 * RECENT_MS, and those whose steps the last run or playback (`steps`) performed.
 */
export function detectRecent(ops: SavedOperation[], runs: RunSummary[], steps: WorkflowStep[], now = Date.now()): DetectedOperation[] {
  const recent = runs.filter((r) => now - r.time <= RECENT_MS);
  const found: DetectedOperation[] = [];
  for (const op of ops) {
    const run = recent.find((r) => runOf(op, r));
    if (run) found.push({ op, via: 'run', time: run.time });
    else if (stepOverlap(op, steps) >= SAME_OPERATION) found.push({ op, via: 'steps', time: now });
  }
  return found.sort((a, b) => b.time - a.time);
}

/** Every saved operation that achieves the same goal as `op` (itself included). */
export const variantsOf = (op: SavedOperation, ops: SavedOperation[]) => ops.filter((o) => o.id === op.id || operationMatch(op.goal, o) >= SAME_OPERATION || operationMatch(o.goal, op) >= SAME_OPERATION);

/** How a variant scores: 0.6 × its real-run success rate + 0.4 × habit success rate + 0.05 per anchored target. */
export function scoreVariant(op: SavedOperation, habits: Habit[], context: string): VariantScore {
  const runRate = (op.successes + 1) / (op.runs + 2);
  const targets = [...new Set(op.steps.map((s) => s.target ?? s.name))];
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const known = targets.map((t) => habits.find((h) => same(h.target, t) && same(h.context, context))).filter((h): h is Habit => !!h);
  const habitRate = known.length ? known.reduce((sum, h) => sum + successRate(h), 0) / known.length : 0.5;
  const anchors = targets.filter((t) => anchoredHabit(habits, t, context)).length;
  return { op, score: 0.6 * runRate + 0.4 * habitRate + 0.05 * anchors, runRate, habitRate, anchors };
}

/** The best-scoring variant of `op` among the saved operations. */
export function bestVariant(op: SavedOperation, ops: SavedOperation[], habits: Habit[], context: string): VariantScore {
  return variantsOf(op, ops).map((o) => scoreVariant(o, habits, context)).sort((a, b) => b.score - a.score)[0];
}

/** One retry's screenshot verification. */
export interface RetryCheck {
  verified: boolean;
  detail: string;
}

/**
 * A retry is verified when the screen after it matches the operation's last reference screenshot;
 * without a reference, when every step executed and the screen changed from before the run.
 */
export function verifyRetry(after: Frame | null, before: Frame | null, reference: Frame | null, allExecuted: boolean): RetryCheck {
  if (!after) return { verified: false, detail: 'no screenshot after the run to compare' };
  if (reference) {
    const d = frameDistance(reference.data, after.data);
    return { verified: d <= MATCHED, detail: `screen ${d <= MATCHED ? 'matches' : 'differs from'} the reference screenshot (distance ${d.toFixed(3)}, limit ${MATCHED})` };
  }
  const changed = before ? frameDistance(before.data, after.data) : 0;
  const verified = allExecuted && changed > CHANGED;
  return { verified, detail: `no reference screenshot — ${allExecuted ? 'every step executed' : 'not every step executed'}, screen ${changed > CHANGED ? 'changed' : 'unchanged'} (distance ${changed.toFixed(3)})` };
}
