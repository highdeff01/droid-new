import { uid } from './planner.js';
import type { LogEntry, WorkflowStep } from './types.js';
import type { GoalCheck } from './assist-ai.js';
import type { RunOutcome } from './run-stats.js';

/** Most goal records kept, in memory and in storage (oldest are pruned first). */
export const GOAL_LIMIT = 100;
/** Default stall threshold: setbacks in a row before the tracer says progress stalled. */
export const DEFAULT_GOAL_STALL = 2;
/** How many goals each memory list (recent / important / blacklisted) holds. */
export const MEMORY_LIMIT = 5;

/** Where a goal came from: typed by the user, derived by the AI, or a loaded workflow pack. */
export const GOAL_SOURCES = ['user', 'ai', 'workflow'] as const;
export type GoalSource = (typeof GOAL_SOURCES)[number];

export const GOAL_STATUSES = ['active', 'paused', 'completed', 'failed', 'abandoned'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** A plan step as the tracer sees it: not run yet, executed, confirmed by its screenshot verdict, or failed. */
export const STEP_STATES = ['pending', 'done', 'verified', 'failed'] as const;
export type StepState = (typeof STEP_STATES)[number];

/** What put the run off its path. */
export const OBSTACLE_CAUSES = ['step', 'drift', 'popup', 'verdict', 'no-progress', 'review'] as const;
export type ObstacleCause = (typeof OBSTACLE_CAUSES)[number];

/** One plan step's completion state with the time of each change. */
export interface StepTrace {
  name: string;
  state: StepState;
  /** When the state last changed. */
  at: number;
  doneAt?: number;
  verifiedAt?: number;
  failedAt?: number;
}

export interface Obstacle {
  time: number;
  cause: ObstacleCause;
  text: string;
}

/** The latest goal check the tracer saw, with the time it was made. */
export interface TracedCheck {
  time: number;
  complete: boolean;
  progress: boolean;
  reason: string;
}

/** One operation's goal, traced live and persisted. */
export interface GoalRecord {
  id: string;
  goal: string;
  source: GoalSource;
  createdAt: number;
  updatedAt: number;
  status: GoalStatus;
  /** The plan's step ids, in plan order. */
  stepIds: string[];
  /** Completion state per step id. */
  steps: Record<string, StepTrace>;
  obstacles: Obstacle[];
  /** Step retries used across the goal's runs. */
  retries: number;
  /** The saved flow (card id) the goal replays or was saved as. */
  workflowId: string | null;
  /** The run summaries of the goal's runs, newest first. */
  runIds: string[];
  /** Verified steps / plan steps, as a rounded percentage. */
  progress: number;
  /** Failed steps and no-progress checks in a row. */
  stalls: number;
  /** Progress at the last goal check, for measuring traced progress between checks. */
  checkedProgress: number;
  lastCheck: TracedCheck | null;
}

/** Everything the tracer reacts to. */
export type TraceEvent =
  | { kind: 'plan'; steps: Array<Pick<WorkflowStep, 'id' | 'name'>>; append: boolean }
  | { kind: 'step'; stepId: string; name: string; ok: boolean; executed: boolean; detail: string }
  | { kind: 'verdict'; stepId: string; name: string; success: boolean }
  | { kind: 'retries'; count: number }
  | { kind: 'deviation'; cause: ObstacleCause; text: string }
  | { kind: 'check'; complete: boolean; progress: boolean; reason: string }
  | { kind: 'run'; runId: string; outcome: RunOutcome; flowId: string | null };

export type NoticeKind = 'step-done' | 'step-failed' | 'off-path' | 'stalled' | 'complete' | 'ended';

/** A notification the tracer emits. */
export interface Notice {
  kind: NoticeKind;
  text: string;
  tone: LogEntry['tone'];
}

/** The record after one event and the notifications it raised. */
export interface Traced {
  record: GoalRecord;
  notices: Notice[];
}

/** What an event is traced with: the time and the stall threshold (goalStall setting). */
export interface TraceContext {
  now: number;
  stallLimit: number;
}

const NOTICE_TONE: Record<NoticeKind, LogEntry['tone']> = { 'step-done': 'ok', 'step-failed': 'error', 'off-path': 'warn', stalled: 'warn', complete: 'ok', ended: 'warn' };
const notice = (kind: NoticeKind, text: string): Notice => ({ kind, text, tone: NOTICE_TONE[kind] });
const unchanged = (record: GoalRecord): Traced => ({ record, notices: [] });

const COUNTED: ReadonlySet<StepState> = new Set(['done', 'verified']);
const FINISHED: ReadonlySet<GoalStatus> = new Set(['completed', 'failed', 'abandoned']);

/** Plan steps executed without a failing screenshot verdict. */
export const verifiedCount = (r: Pick<GoalRecord, 'stepIds' | 'steps'>) => r.stepIds.filter((id) => COUNTED.has(r.steps[id]?.state)).length;

/** Verified steps / plan steps as a rounded percentage; 0 with no plan. */
export const goalProgress = (r: Pick<GoalRecord, 'stepIds' | 'steps'>) => (r.stepIds.length ? Math.round((verifiedCount(r) * 100) / r.stepIds.length) : 0);

const pendingSteps = (steps: Array<Pick<WorkflowStep, 'id' | 'name'>>, now: number): Record<string, StepTrace> =>
  Object.fromEntries(steps.map((s) => [s.id, { name: s.name, state: 'pending', at: now }]));

/** A new active goal record for one operation. */
export function createGoal(init: { goal: string; source: GoalSource; steps: Array<Pick<WorkflowStep, 'id' | 'name'>>; workflowId?: string | null }, now = Date.now()): GoalRecord {
  return {
    id: uid('goal'),
    goal: init.goal.trim(),
    source: init.source,
    createdAt: now,
    updatedAt: now,
    status: 'active',
    stepIds: init.steps.map((s) => s.id),
    steps: pendingSteps(init.steps, now),
    obstacles: [],
    retries: 0,
    workflowId: init.workflowId ?? null,
    runIds: [],
    progress: 0,
    stalls: 0,
    checkedProgress: 0,
    lastCheck: null,
  };
}

const counts = (r: GoalRecord) => `${verifiedCount(r)}/${r.stepIds.length} verified (${goalProgress(r)}%)`;

/** `r` with step `id` moved to `state`, stamping the matching timestamp. */
function setStep(r: GoalRecord, id: string, name: string, state: StepState, now: number): GoalRecord {
  const stamp = { done: 'doneAt', verified: 'verifiedAt', failed: 'failedAt', pending: null }[state];
  const prev = r.steps[id] ?? { name, state: 'pending', at: now };
  const step: StepTrace = { ...prev, name, state, at: now, ...(stamp ? { [stamp]: now } : {}) };
  return { ...r, stepIds: r.stepIds.includes(id) ? r.stepIds : [...r.stepIds, id], steps: { ...r.steps, [id]: step } };
}

/** Records an obstacle unless it repeats the latest one; `added` says whether it was new. */
function addObstacle(r: GoalRecord, cause: ObstacleCause, text: string, now: number): { record: GoalRecord; added: boolean } {
  const last = r.obstacles[r.obstacles.length - 1];
  if (last?.cause === cause && last.text === text) return { record: r, added: false };
  return { record: { ...r, obstacles: [...r.obstacles, { time: now, cause, text }] }, added: true };
}

/** One more stall; notifies once when the run reaches the stall threshold. */
function stall(r: GoalRecord, ctx: TraceContext, why: string): Traced {
  const stalls = r.stalls + 1;
  const notices = stalls === ctx.stallLimit ? [notice('stalled', `Progress stalled on "${r.goal}" — ${stalls} setback(s) in a row at ${counts(r)}; last: ${why}`)] : [];
  return { record: { ...r, stalls }, notices };
}

/** An off-path obstacle: recorded and notified once, and counted as a stall when `stalls` is set. */
function offPath(r: GoalRecord, cause: ObstacleCause, text: string, ctx: TraceContext, stalls: boolean): Traced {
  const { record, added } = addObstacle(r, cause, text, ctx.now);
  const off = added ? [notice('off-path', `Off-path from "${r.goal}" — ${text}`)] : [];
  if (!stalls) return { record, notices: off };
  const s = stall(record, ctx, text);
  return { record: s.record, notices: [...off, ...s.notices] };
}

function complete(r: GoalRecord, why: string): Traced {
  if (r.status === 'completed') return unchanged(r);
  return { record: { ...r, status: 'completed' }, notices: [notice('complete', `Goal "${r.goal}" verifiably complete — ${why}`)] };
}

function tracePlan(r: GoalRecord, e: Extract<TraceEvent, { kind: 'plan' }>, ctx: TraceContext): Traced {
  if (!e.append) return unchanged({ ...r, status: 'active', stepIds: e.steps.map((s) => s.id), steps: pendingSteps(e.steps, ctx.now) });
  const fresh = e.steps.filter((s) => !r.stepIds.includes(s.id));
  return unchanged({ ...r, status: 'active', stepIds: [...r.stepIds, ...fresh.map((s) => s.id)], steps: { ...r.steps, ...pendingSteps(fresh, ctx.now) } });
}

function traceStep(r: GoalRecord, e: Extract<TraceEvent, { kind: 'step' }>, ctx: TraceContext): Traced {
  if (e.ok && !e.executed) return unchanged(r);
  if (e.ok) {
    const record = { ...setStep(r, e.stepId, e.name, 'done', ctx.now), stalls: 0 };
    return { record, notices: [notice('step-done', `Step "${e.name}" done — ${counts(record)}`)] };
  }
  const failed = addObstacle(setStep(r, e.stepId, e.name, 'failed', ctx.now), 'step', `"${e.name}" failed: ${e.detail}`, ctx.now).record;
  const s = stall(failed, ctx, `"${e.name}" failed`);
  return { record: s.record, notices: [notice('step-failed', `Step "${e.name}" failed — ${e.detail}`), ...s.notices] };
}

function traceVerdict(r: GoalRecord, e: Extract<TraceEvent, { kind: 'verdict' }>, ctx: TraceContext): Traced {
  if (e.success) return unchanged(r.steps[e.stepId]?.state === 'done' ? setStep(r, e.stepId, e.name, 'verified', ctx.now) : r);
  return offPath(setStep(r, e.stepId, e.name, 'failed', ctx.now), 'verdict', `screenshot verdict says "${e.name}" did not work`, ctx, true);
}

const traceRetries = (r: GoalRecord, e: Extract<TraceEvent, { kind: 'retries' }>): Traced => unchanged(e.count > 0 ? { ...r, retries: r.retries + e.count } : r);

const traceDeviation = (r: GoalRecord, e: Extract<TraceEvent, { kind: 'deviation' }>, ctx: TraceContext): Traced => offPath(r, e.cause, e.text, ctx, false);

function traceCheck(r: GoalRecord, e: Extract<TraceEvent, { kind: 'check' }>, ctx: TraceContext): Traced {
  const progressed = e.progress || r.progress > r.checkedProgress;
  const checked: GoalRecord = { ...r, checkedProgress: r.progress, lastCheck: { time: ctx.now, complete: e.complete, progress: progressed, reason: e.reason } };
  if (e.complete) return complete(checked, e.reason);
  if (progressed) return unchanged({ ...checked, stalls: 0 });
  return offPath(checked, 'no-progress', `goal check found no progress — ${e.reason}`, ctx, true);
}

/** The status a goal takes when one of its runs ends with each outcome. */
const RUN_STATUS: Record<RunOutcome, (r: GoalRecord) => GoalStatus> = {
  'dry-run': (r) => r.status,
  stopped: () => 'abandoned',
  failed: () => 'failed',
  success: (r) => (r.lastCheck && !r.lastCheck.complete ? 'failed' : r.progress === 100 ? 'completed' : r.status),
};

function traceRun(r: GoalRecord, e: Extract<TraceEvent, { kind: 'run' }>): Traced {
  const linked: GoalRecord = { ...r, runIds: [e.runId, ...r.runIds.filter((id) => id !== e.runId)], workflowId: e.flowId ?? r.workflowId };
  if (r.status === 'completed') return unchanged(linked);
  const status = RUN_STATUS[e.outcome](linked);
  if (status === 'completed') return complete(linked, `run ended with ${counts(linked)}`);
  const notices = status !== r.status && FINISHED.has(status) ? [notice('ended', `Goal "${r.goal}" ${status} — run ${e.outcome} at ${counts(linked)}`)] : [];
  return { record: { ...linked, status }, notices };
}

/** One handler per event kind. */
const HANDLERS: { [K in TraceEvent['kind']]: (r: GoalRecord, e: Extract<TraceEvent, { kind: K }>, ctx: TraceContext) => Traced } = {
  plan: tracePlan,
  step: traceStep,
  verdict: traceVerdict,
  retries: traceRetries,
  deviation: traceDeviation,
  check: traceCheck,
  run: traceRun,
};

/** Applies one event to the record: the updated record (progress recomputed, time stamped) and its notifications. */
export function trace(r: GoalRecord, e: TraceEvent, ctx: TraceContext): Traced {
  const handler = HANDLERS[e.kind] as (r: GoalRecord, e: TraceEvent, ctx: TraceContext) => Traced;
  const out = handler(r, e, ctx);
  if (out.record === r) return out;
  return { record: { ...out.record, progress: goalProgress(out.record), updatedAt: ctx.now }, notices: out.notices };
}

/**
 * The goal check auto-continue rules on, against the traced state: progress counts when the model saw it
 * or the traced verified steps grew since the last check, and the reason carries the traced progress.
 */
export function tracedCheck(r: GoalRecord, check: GoalCheck): GoalCheck {
  return { ...check, progress: check.progress || r.progress > r.checkedProgress, reason: `${check.reason} · traced ${counts(r)}` };
}

/** `record` first as the only active goal: any other active goal is paused, never overwritten; pruned to GOAL_LIMIT. */
export function startGoal(goals: GoalRecord[], record: GoalRecord): GoalRecord[] {
  const rest = goals.map((g) => (g.status === 'active' ? { ...g, status: 'paused' as const } : g));
  return [record, ...rest].slice(0, GOAL_LIMIT);
}

/** `goals` with goal `id` replaced by `fn` of it. */
export const updateGoal = (goals: GoalRecord[], id: string, fn: (g: GoalRecord) => GoalRecord) => goals.map((g) => (g.id === id ? fn(g) : g));

/** Goals loaded at startup: an active goal's operation cannot still be running, so it is paused. */
export const hydrateGoals = (goals: GoalRecord[]) => goals.map((g) => (g.status === 'active' ? { ...g, status: 'paused' as const } : g));

/** Finished goals for the memory system: newest overall, completed ones related to a text, and failed or abandoned related ones. */
export interface GoalMemory {
  recent: GoalRecord[];
  important: GoalRecord[];
  blacklisted: GoalRecord[];
}

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
const related = (a: string, b: Set<string>) => [...words(a)].some((w) => b.has(w));

/** The memory lists of finished goals relevant to `text`, newest first. */
export function goalMemory(goals: GoalRecord[], text: string, limit = MEMORY_LIMIT): GoalMemory {
  const finished = goals.filter((g) => FINISHED.has(g.status)).sort((a, b) => b.updatedAt - a.updatedAt);
  const near = finished.filter((g) => related(g.goal, words(text)));
  return {
    recent: finished.slice(0, limit),
    important: near.filter((g) => g.status === 'completed').slice(0, limit),
    blacklisted: near.filter((g) => g.status !== 'completed').slice(0, limit),
  };
}

const lastObstacle = (g: GoalRecord) => g.obstacles[g.obstacles.length - 1]?.text ?? 'no obstacle recorded';

/** Planner context lines of a goal memory. */
export function memoryLines(m: GoalMemory): string[] {
  return [
    ...m.recent.map((g) => `Recent goal: "${g.goal}" — ${g.status} at ${g.progress}%`),
    ...m.important.map((g) => `Important (worked before): "${g.goal}" — ${g.stepIds.length} step(s), ${g.retries} retries`),
    ...m.blacklisted.map((g) => `Blacklisted (${g.status} before, avoid repeating): "${g.goal}" — ${lastObstacle(g)}`),
  ];
}

/** The pre-action briefing's goal-progress line. */
export const goalBriefingLine = (r: GoalRecord) => `Goal progress: ${counts(r)} · ${r.status} · ${r.obstacles.length} obstacle(s) · ${r.retries} retries used`;

/** The Goal tracer's live status in the agents panel. */
export function tracerStatus(r: GoalRecord | null, on: boolean): string {
  if (!on) return 'off';
  return r ? `tracing "${r.goal}" — ${counts(r)} · ${r.status}` : 'idle — no active goal';
}
