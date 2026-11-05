import type { Frame, WorkflowStep } from './types.js';
import { similarity, uid } from './planner.js';

/** Most saved operations kept. */
export const OPERATION_LIMIT = 50;
/** Most reference screenshots kept per operation. */
export const OPERATION_SHOT_LIMIT = 6;

/** How an operation was made: planned by the AI from a request, recorded by hand, or rebuilt from a playback. */
export const OPERATION_SOURCES = ['ai', 'recorded', 'playback'] as const;
export type OperationSource = (typeof OPERATION_SOURCES)[number];

/** A named, reusable operation: its steps, the goal they achieve and reference screenshots of the result. */
export interface SavedOperation {
  id: string;
  name: string;
  /** What the operation achieves, in words ("go to chrome and open youtube"); runs verify it. */
  goal: string;
  steps: WorkflowStep[];
  /** Reference screenshots, oldest first; the last one shows the expected end state. */
  screenshots: Frame[];
  source: OperationSource;
  savedAt: number;
  /** Real-input runs of this operation, and those that executed every step. */
  runs: number;
  successes: number;
  lastRun?: number;
}

const norm = (s: string) => s.trim().toLowerCase();
const pendingStep = ({ beforeFrame: _b, afterFrame: _a, shot: _s, ...s }: WorkflowStep): WorkflowStep => ({ ...s, status: 'pending' });

/** The reference screenshots of a run: each step's template, then the screen after it, de-duplicated by frame id. */
export function referenceShots(steps: WorkflowStep[], current: Frame | null): Frame[] {
  const all = [...steps.flatMap((s) => [s.refFrame, s.afterFrame ?? s.shot]), current].filter((f): f is Frame => !!f);
  const unique = all.filter((f, i) => all.findIndex((g) => g.id === f.id) === i);
  return unique.slice(-OPERATION_SHOT_LIMIT);
}

/** A new operation from the current steps; steps are reset to pending and stripped of run evidence. */
export function createOperation(input: { name: string; goal: string; steps: WorkflowStep[]; screenshots: Frame[]; source: OperationSource }, now = Date.now()): SavedOperation {
  const name = input.name.trim();
  return { id: uid('op'), name, goal: input.goal.trim() || name, steps: input.steps.map(pendingStep), screenshots: input.screenshots.slice(-OPERATION_SHOT_LIMIT), source: input.source, savedAt: now, runs: 0, successes: 0 };
}

/** `op` first; an operation with the same name is replaced (keeping its id and counters), every other one is kept. */
export function upsertOperation(ops: SavedOperation[], op: SavedOperation): { ops: SavedOperation[]; replaced: SavedOperation | null } {
  const replaced = ops.find((o) => norm(o.name) === norm(op.name)) ?? null;
  const merged = replaced ? { ...op, id: replaced.id, runs: replaced.runs, successes: replaced.successes, ...(replaced.lastRun ? { lastRun: replaced.lastRun } : {}) } : op;
  return { ops: [merged, ...ops.filter((o) => o !== replaced)].slice(0, OPERATION_LIMIT), replaced };
}

/** The operations with run `id` counted: one more run, and a success when it fully executed. */
export function countRun(ops: SavedOperation[], id: string, success: boolean, now = Date.now()): SavedOperation[] {
  return ops.map((o) => (o.id === id ? { ...o, runs: o.runs + 1, successes: o.successes + (success ? 1 : 0), lastRun: now } : o));
}

/** How well `text` matches an operation's name, goal and step names (0..1). */
export const operationMatch = (text: string, op: SavedOperation) => similarity(text, `${op.name} ${op.goal} ${op.steps.map((s) => s.target ?? s.name).join(' ')}`);

/** The operations `text` matches at all, best first: what the AI suggests for a goal or a finished run. */
export function suggestOperations(text: string, ops: SavedOperation[], limit = 3): SavedOperation[] {
  return ops
    .map((op) => ({ op, score: operationMatch(text, op) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((m) => m.op);
}

/** One suggestion line for the log and the notification. */
export const suggestionText = (op: SavedOperation) => `"${op.name}" (${op.steps.length} step(s), ${op.successes}/${op.runs} run(s) succeeded)`;

/** Shows a desktop notification when the user already granted permission (never prompts); whether it was shown. */
export function notifySuggestion(body: string): boolean {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  const shown = new Notification('Droid Assist suggests', { body });
  return !!shown;
}
