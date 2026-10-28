import type { GoalRecord } from './goal-tracer.js';
import type { TrailPoint, WorkflowStep } from './types.js';

export interface Point {
  x: number;
  y: number;
}

/** One performStep call: where the cursor was, where it aimed, and when it ran. */
export interface OperationAttempt {
  id: string;
  stepId: string;
  name: string;
  action: WorkflowStep['action'];
  actor: string;
  intent: string;
  /** The cursor before the attempt; null when it had not moved yet. */
  from: Point | null;
  /** The step's (drift-corrected) target. */
  to: Point;
  start: number;
  end?: number;
  ok?: boolean;
}

/** Most attempts the engine keeps. */
export const ATTEMPT_LIMIT = 30;

/** An attempt's planned straight line against the trail the cursor actually drew during it. */
export interface AttemptPath {
  attempt: OperationAttempt;
  planned: Point[];
  actual: Point[];
}

/** Everything the Current operation panel shows. */
export interface OperationView {
  step: WorkflowStep | null;
  attempts: AttemptPath[];
  goal: string;
  progress: number | null;
  verified: number;
  total: number;
  attention: Point | null;
  attentionLabel: string;
  intent: string;
  next: string | null;
}

export interface OperationInput {
  steps: WorkflowStep[];
  activeIndex: number | null;
  attempts: OperationAttempt[];
  trail: TrailPoint[];
  record: GoalRecord | null;
  goal: string;
  cursor: Point | null;
}

/** The running step, else the step of the newest attempt. */
function activeStep(i: OperationInput): WorkflowStep | null {
  const running = i.activeIndex === null ? undefined : i.steps[i.activeIndex];
  if (running) return running;
  const last = i.attempts.at(-1);
  return (last && i.steps.find((s) => s.id === last.stepId)) ?? null;
}

/** The planned line and the actual trail of one attempt (the trail between its start and end). */
export function attemptPath(a: OperationAttempt, trail: TrailPoint[], now: number): AttemptPath {
  const end = a.end ?? now;
  const actual = trail.filter((p) => p.t >= a.start && p.t <= end).map(({ x, y }) => ({ x, y }));
  return { attempt: a, planned: a.from ? [a.from, a.to] : [a.to], actual };
}

/** The first plan step after `step` the tracer does not count as done or verified. */
function nextStep(i: OperationInput, step: WorkflowStep | null): string | null {
  const after = step ? i.steps.slice(i.steps.findIndex((s) => s.id === step.id) + 1) : i.steps;
  const state = (s: WorkflowStep) => i.record?.steps[s.id]?.state;
  const open = after.find((s) => s.status !== 'done' && state(s) !== 'done' && state(s) !== 'verified');
  return open ? `${open.action} "${open.target ?? open.name}"` : null;
}

/** Where the AI looks: the target of its open attempt, else the cursor. */
function attention(i: OperationInput, open: OperationAttempt | undefined): { point: Point | null; label: string } {
  if (open) return { point: open.to, label: `${open.name} — aiming at its target` };
  return i.cursor ? { point: i.cursor, label: 'resting at the AI cursor' } : { point: null, label: 'nowhere yet' };
}

/** The Current operation view: step, goal-tracer progress, attention, attempt paths, next step and main goal. */
export function operationView(i: OperationInput, now = Date.now()): OperationView {
  const step = activeStep(i);
  const mine = step ? i.attempts.filter((a) => a.stepId === step.id) : [];
  const open = i.attempts.find((a) => a.end === undefined);
  const ids = i.record?.stepIds ?? [];
  const verified = ids.filter((id) => i.record?.steps[id]?.state === 'verified').length;
  const focus = attention(i, open);
  return {
    step,
    attempts: mine.map((a) => attemptPath(a, i.trail, now)),
    goal: i.record?.goal || i.goal.trim(),
    progress: i.record ? i.record.progress : null,
    verified,
    total: ids.length,
    attention: focus.point,
    attentionLabel: focus.label,
    intent: mine.at(-1)?.intent ?? '',
    next: nextStep(i, step),
  };
}
