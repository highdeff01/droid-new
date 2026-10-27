import type { LearnedPattern, StepAction } from './types.js';
import { STEP_ACTIONS } from './types.js';
import type { HabitOutcome } from './habits.js';
import { newPattern } from './flow-memory.js';
import { uid } from './planner.js';
import { isPlannedStep, type PlannedStep } from './project.js';

/** Most queued requests kept (decided ones are pruned first). */
export const APPROVAL_LIMIT = 100;
/** Most learned methods kept. */
export const LEARNED_LIMIT = 200;

/** Actions that move or look but never change anything: always pre-approved. */
export const SAFE_ACTIONS: readonly StepAction[] = ['move', 'scroll', 'wait', 'calc', 'measure'];

/** Where a proposed command stands: waiting, or decided by the user. */
export type ApprovalStatus = 'pending' | 'approved' | 'edited' | 'rejected';

/** One proposed command waiting for (or decided by) the user. */
export interface ApprovalRequest {
  id: string;
  projectId: string;
  step: PlannedStep;
  time: number;
  status: ApprovalStatus;
  /** The step as edited by the user. */
  edited?: PlannedStep;
}

/** A command the user approved once: the same action on the same target runs without asking again. */
export interface LearnedMethod {
  action: StepAction;
  target: string;
  time: number;
}

/** The approval queue and the methods learned from it (persisted). */
export interface ApprovalState {
  queue: ApprovalRequest[];
  learned: LearnedMethod[];
}

/** No queued requests and no learned methods. */
export const EMPTY_APPROVALS: ApprovalState = { queue: [], learned: [] };

/** What the user decided on a request. */
export type Decision = { kind: 'approve' } | { kind: 'edit'; step: PlannedStep } | { kind: 'reject' };

/** A decision's effect: the new state, the step to run (null when rejected) and what the habits/knowledge systems learn. */
export interface Decided {
  state: ApprovalState;
  request: ApprovalRequest;
  step: PlannedStep | null;
  habit: HabitOutcome;
  pattern: LearnedPattern;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const targetOf = (s: PlannedStep) => s.target ?? s.name;
const sameMethod = (m: LearnedMethod, s: PlannedStep) => m.action === s.action && norm(m.target) === norm(targetOf(s));
/** A step as one line of text. */
export const commandText = (s: PlannedStep) => `${s.action} "${targetOf(s)}"${s.text ? ` with "${s.text}"` : ''}`;

/** Within the pre-approved bounds: a safe action, or an action+target the user approved before. */
export const isPreApproved = (state: ApprovalState, step: PlannedStep) => SAFE_ACTIONS.includes(step.action) || state.learned.some((m) => sameMethod(m, step));

/** The pending requests of one project (or all), oldest first. */
export const pendingFor = (state: ApprovalState, projectId?: string) => state.queue.filter((r) => r.status === 'pending' && (!projectId || r.projectId === projectId)).reverse();

/** Pending requests first, then decided ones, newest first, capped. */
const capQueue = (queue: ApprovalRequest[]) => [...queue.filter((r) => r.status === 'pending'), ...queue.filter((r) => r.status !== 'pending')].slice(0, APPROVAL_LIMIT);

/** Queues each step outside the bounds that is not already pending for the project; returns the state and the queued count. */
export function enqueue(state: ApprovalState, projectId: string, steps: PlannedStep[], now = Date.now()): { state: ApprovalState; queued: ApprovalRequest[] } {
  const pending = pendingFor(state, projectId);
  const queued = steps
    .filter((s) => !isPreApproved(state, s) && !pending.some((r) => r.step.id === s.id))
    .map((step): ApprovalRequest => ({ id: uid('appr'), projectId, step, time: now, status: 'pending' }));
  return { state: { ...state, queue: capQueue([...queued.reverse(), ...state.queue]) }, queued };
}

/** `learned` with the step's method first. */
const learn = (learned: LearnedMethod[], step: PlannedStep, now: number) => [{ action: step.action, target: targetOf(step), time: now }, ...learned.filter((m) => !sameMethod(m, step))].slice(0, LEARNED_LIMIT);

/** A decision's status, the step it runs (null = none) and the lesson it teaches. */
interface Outcome {
  status: ApprovalStatus;
  run: PlannedStep | null;
  lesson: { kind: LearnedPattern['kind']; text: string };
}

/** The outcome of `decision` on the proposed `step`. */
function outcomeOf(step: PlannedStep, decision: Decision): Outcome {
  switch (decision.kind) {
    case 'approve': return { status: 'approved', run: step, lesson: { kind: 'add', text: `User approved ${commandText(step)}` } };
    case 'edit': return { status: 'edited', run: { ...decision.step, id: step.id }, lesson: { kind: 'add', text: `User corrected ${commandText(step)} to ${commandText(decision.step)}` } };
    case 'reject': return { status: 'rejected', run: null, lesson: { kind: 'avoid', text: `User rejected ${commandText(step)}` } };
  }
}

/**
 * Applies the user's decision to a pending request. Approved and edited commands become learned
 * methods; every decision yields a habit outcome and a learned pattern for planning. Null when
 * the request is unknown or already decided.
 */
export function decide(state: ApprovalState, requestId: string, decision: Decision, context: string, now = Date.now()): Decided | null {
  const request = state.queue.find((r) => r.id === requestId);
  if (!request || request.status !== 'pending') return null;
  const out = outcomeOf(request.step, decision);
  const decided: ApprovalRequest = { ...request, status: out.status, ...(decision.kind === 'edit' ? { edited: out.run! } : {}) };
  const learned = out.run ? learn(state.learned, out.run, now) : state.learned;
  const habit: HabitOutcome = { target: targetOf(request.step), context, success: !!out.run, [out.lesson.kind]: out.lesson.text };
  return {
    state: { queue: capQueue(state.queue.map((r) => (r.id === requestId ? decided : r))), learned },
    request: decided,
    step: out.run,
    habit,
    pattern: newPattern(out.lesson.kind, out.lesson.text, context),
  };
}

/** Drops the pending requests of a project (it was deleted). */
export const dropProject = (state: ApprovalState, projectId: string): ApprovalState => ({ ...state, queue: state.queue.filter((r) => r.projectId !== projectId || r.status !== 'pending') });

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const STATUSES: readonly ApprovalStatus[] = ['pending', 'approved', 'edited', 'rejected'];

/** A stored approval request is well formed (used when loading from storage). */
export const isApprovalRequest = (v: unknown): v is ApprovalRequest => isObject(v) && typeof v.id === 'string' && typeof v.projectId === 'string' && isPlannedStep(v.step)
  && isNum(v.time) && STATUSES.includes(v.status as ApprovalStatus) && (v.edited === undefined || isPlannedStep(v.edited));

/** A stored learned method is well formed (used when loading from storage). */
export const isLearnedMethod = (v: unknown): v is LearnedMethod => isObject(v) && STEP_ACTIONS.includes(v.action as StepAction) && typeof v.target === 'string' && isNum(v.time);
