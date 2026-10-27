import type { WorkflowStep } from './types.js';
import { STEP_ACTIONS } from './types.js';
import type { GoalCheck } from './assist-ai.js';
import { uid } from './planner.js';

/** Most projects kept; finished ones are pruned first. */
export const PROJECT_LIMIT = 30;
/** Transitions kept per project. */
export const HISTORY_LIMIT = 120;
/** Injections kept per project. */
export const INJECTION_LIMIT = 50;
/** Goal checks kept per project. */
export const CHECK_LIMIT = 30;
/** Alternative methods tried before a project fails. */
export const ALT_METHOD_LIMIT = 2;
/** Follow-up checks (turns) before a project fails as unfinished. */
export const PROJECT_TURN_LIMIT = 20;

/** Every lifecycle state of a project. */
export const PROJECT_STATES = ['working', 'waiting-for-reply', 'testing', 'replying', 'retesting', 'retrying', 'correcting', 'verifying', 'acting', 'follow-up', 'complete', 'failed', 'on-hold'] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];

/** The states each state may move to. `complete` is final; a failed project can only be resumed by the user. */
export const TRANSITIONS: Record<ProjectState, readonly ProjectState[]> = {
  working: ['waiting-for-reply', 'testing', 'follow-up', 'retrying', 'on-hold', 'failed'],
  'waiting-for-reply': ['testing', 'working', 'on-hold', 'failed'],
  testing: ['replying', 'retrying', 'on-hold'],
  replying: ['verifying', 'retesting', 'retrying', 'on-hold'],
  retesting: ['replying', 'verifying', 'retrying', 'on-hold'],
  retrying: ['correcting', 'failed', 'on-hold'],
  correcting: ['retesting', 'waiting-for-reply', 'retrying', 'on-hold', 'failed'],
  verifying: ['acting', 'retrying', 'on-hold'],
  acting: ['follow-up', 'retrying', 'on-hold'],
  'follow-up': ['complete', 'working', 'retrying', 'failed', 'on-hold'],
  complete: [],
  failed: ['working'],
  'on-hold': ['working', 'failed'],
};

/** What the Projects panel shows as each state's next action. */
const NEXT_ACTION: Record<ProjectState, string> = {
  working: 'Plan the next steps from the goal and injected info',
  'waiting-for-reply': 'Waiting for your approval of proposed commands',
  testing: 'Dry-run the planned steps',
  replying: 'Read the test result',
  retesting: 'Dry-run the corrected steps',
  retrying: 'Retry with the retry ladder or an alternative method',
  correcting: 'Re-plan around what failed',
  verifying: 'Check the guardrails before acting',
  acting: 'Run the steps as real input',
  'follow-up': 'Check the goal on the live screen',
  complete: 'Nothing left to do',
  failed: 'Resume to try again',
  'on-hold': 'Restore context and continue',
};

/** Where an injected piece of info came from. */
export const INJECTION_SOURCES = ['user', 'agent', 'main-ai', 'other-ai'] as const;
export type InjectionSource = (typeof INJECTION_SOURCES)[number];

/** Info added to a running project, fed into its next turn. */
export interface Injection {
  id: string;
  source: InjectionSource;
  /** Who sent it: "you", an agent name, "goal check", "screen AI". */
  from: string;
  text: string;
  time: number;
  /** The turn that consumed it; undefined while it waits for the next turn. */
  consumedTurn?: number;
}

/** One goal check of the project. */
export interface GoalEntry {
  complete: boolean;
  progress: boolean;
  reason: string;
  time: number;
}

/** The project's goal and every check of it on the live screen, newest first. */
export interface GoalRecord {
  goal: string;
  checks: GoalEntry[];
  complete: boolean;
}

/** One lifecycle transition, numbered by the turn it happened in. */
export interface TurnRecord {
  turn: number;
  time: number;
  from: ProjectState;
  to: ProjectState;
  note: string;
}

/** An alternative method tried after the retry ladder ran out. */
export interface AltAttempt {
  method: string;
  /** The turn it was tried in (alternative methods are counted per turn). */
  turn: number;
  time: number;
}

/** A planned step as persisted (no screenshots). */
export type PlannedStep = Pick<WorkflowStep, 'id' | 'name' | 'action' | 'x' | 'y' | 'text' | 'target' | 'endX' | 'endY' | 'endTarget'>;

/** Whether the project is done and why. */
export interface Completion {
  done: boolean;
  reason: string;
  time?: number;
}

/** A multi-turn project the AI follows through until nothing is left to do. */
export interface Project {
  id: string;
  name: string;
  goal: string;
  record: GoalRecord;
  state: ProjectState;
  /** Follow-up checks so far. */
  turn: number;
  history: TurnRecord[];
  /** Retries since the current method began. */
  retries: number;
  altMethods: AltAttempt[];
  completion: Completion;
  injections: Injection[];
  /** The steps of the current plan. */
  steps: PlannedStep[];
  /** Steps verified / run by the last test or act. */
  lastRun?: { ok: number; total: number };
  createdAt: number;
  updatedAt: number;
}

/** A new project in `working`. */
export function createProject(name: string, goal: string, now = Date.now()): Project {
  const text = goal.trim();
  return {
    id: uid('proj'),
    name: name.trim() || text.slice(0, 40),
    goal: text,
    record: { goal: text, checks: [], complete: false },
    state: 'working',
    turn: 0,
    history: [],
    retries: 0,
    altMethods: [],
    completion: { done: false, reason: '' },
    injections: [],
    steps: [],
    createdAt: now,
    updatedAt: now,
  };
}

export const canTransition = (from: ProjectState, to: ProjectState) => TRANSITIONS[from].includes(to);

/** The project moved to `to` with the transition logged; throws when the table forbids it. */
export function transition(p: Project, to: ProjectState, note: string, now = Date.now()): Project {
  if (!canTransition(p.state, to)) throw new Error(`Illegal project transition ${p.state} → ${to}`);
  const entry: TurnRecord = { turn: p.turn, time: now, from: p.state, to, note };
  const completion = to === 'complete' || to === 'failed' ? { done: to === 'complete', reason: note, time: now } : p.completion;
  return { ...p, state: to, completion, history: [entry, ...p.history].slice(0, HISTORY_LIMIT), updatedAt: now };
}

/** Finished projects: complete or failed. */
export const isFinished = (p: Project) => p.state === 'complete' || p.state === 'failed';

/** The panel's next-action text for the project. */
export const nextAction = (p: Project) => NEXT_ACTION[p.state];

/** The project with `text` logged as an injection for its next turn; blank text changes nothing. */
export function injectInfo(p: Project, info: { source: InjectionSource; from: string; text: string }, now = Date.now()): Project {
  const text = info.text.trim();
  if (!text) return p;
  const injection: Injection = { id: uid('inj'), source: info.source, from: info.from, text, time: now };
  return { ...p, injections: [injection, ...p.injections].slice(0, INJECTION_LIMIT), updatedAt: now };
}

/** Injections not yet fed into a turn, oldest first. */
export const pendingInjections = (p: Project) => p.injections.filter((i) => i.consumedTurn === undefined).reverse();

/** Marks the pending injections consumed by the current turn and returns them oldest first. */
export function consumeInjections(p: Project): { project: Project; injected: Injection[] } {
  const injected = pendingInjections(p);
  if (!injected.length) return { project: p, injected };
  return { project: { ...p, injections: p.injections.map((i) => (i.consumedTurn === undefined ? { ...i, consumedTurn: p.turn } : i)) }, injected };
}

/** The project with a goal check recorded on its GoalRecord. */
export function recordCheck(p: Project, check: GoalCheck, now = Date.now()): Project {
  const entry: GoalEntry = { complete: check.complete, progress: check.progress, reason: check.reason, time: now };
  return { ...p, record: { ...p.record, checks: [entry, ...p.record.checks].slice(0, CHECK_LIMIT), complete: check.complete }, updatedAt: now };
}

/**
 * Nothing left to do: the goal check says complete, no injected info is still waiting for a turn
 * and no proposed command of the project is waiting for approval.
 */
export function completionCheck(p: Project, check: GoalCheck, pendingApprovals: number): Completion {
  if (!check.complete) return { done: false, reason: `Goal not complete — ${check.reason}` };
  const waiting = pendingInjections(p).length;
  if (waiting) return { done: false, reason: `${waiting} injected item(s) not yet acted on` };
  if (pendingApprovals) return { done: false, reason: `${pendingApprovals} command(s) waiting for approval` };
  return { done: true, reason: `Goal verified complete — ${check.reason}` };
}

/** Text of the project's progress: verified, or its last run and how many goal checks made progress. */
export function progressText(p: Project): string {
  if (p.state === 'complete') return 'Complete';
  const run = p.lastRun ? `${p.lastRun.ok}/${p.lastRun.total} steps` : 'no run yet';
  const made = p.record.checks.filter((c) => c.progress).length;
  return `${run} · ${made}/${p.record.checks.length} checks made progress`;
}

/** A planned step's persisted shape. */
export function toPlanned(s: WorkflowStep): PlannedStep {
  const { id, name, action, x, y, text, target, endX, endY, endTarget } = s;
  return { id, name, action, x, y, ...(text !== undefined ? { text } : {}), ...(target ? { target } : {}), ...(endX !== undefined && endY !== undefined ? { endX, endY } : {}), ...(endTarget ? { endTarget } : {}) };
}

/** A persisted step as a pending workflow step. */
export const toStep = (s: PlannedStep): WorkflowStep => ({ ...s, status: 'pending' });

/** The project with step `stepId` replaced by `step`, or removed when `step` is null. */
export function applyDecision(p: Project, stepId: string, step: PlannedStep | null): Project {
  const steps = step ? p.steps.map((s) => (s.id === stepId ? { ...step, id: stepId } : s)) : p.steps.filter((s) => s.id !== stepId);
  return { ...p, steps };
}

/** Unfinished projects first (newest first), then finished ones, capped at `limit`. */
export function pruneProjects(projects: Project[], limit = PROJECT_LIMIT): Project[] {
  const byNewest = (a: Project, b: Project) => b.updatedAt - a.updatedAt;
  const open = projects.filter((p) => !isFinished(p)).sort(byNewest);
  const done = projects.filter(isFinished).sort(byNewest);
  return [...open, ...done].slice(0, limit);
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isState = (v: unknown): v is ProjectState => PROJECT_STATES.includes(v as ProjectState);
const allOf = (v: unknown, guard: (x: unknown) => boolean) => Array.isArray(v) && v.every(guard);

const isInjection = (v: unknown) => isObject(v) && isStr(v.id) && INJECTION_SOURCES.includes(v.source as InjectionSource) && isStr(v.from) && isStr(v.text) && isNum(v.time) && (v.consumedTurn === undefined || isNum(v.consumedTurn));
const isEntry = (v: unknown) => isObject(v) && typeof v.complete === 'boolean' && typeof v.progress === 'boolean' && isStr(v.reason) && isNum(v.time);
const isTurn = (v: unknown) => isObject(v) && isNum(v.turn) && isNum(v.time) && isState(v.from) && isState(v.to) && isStr(v.note);
const isAlt = (v: unknown) => isObject(v) && isStr(v.method) && isNum(v.turn) && isNum(v.time);
export const isPlannedStep = (v: unknown): v is PlannedStep => isObject(v) && isStr(v.id) && isStr(v.name) && STEP_ACTIONS.includes(v.action as WorkflowStep['action']) && isNum(v.x) && isNum(v.y);
const isRecord = (v: unknown) => isObject(v) && isStr(v.goal) && allOf(v.checks, isEntry) && typeof v.complete === 'boolean';
const isCompletion = (v: unknown) => isObject(v) && typeof v.done === 'boolean' && isStr(v.reason);

/** A structurally valid stored project. */
export function isProject(v: unknown): v is Project {
  return isObject(v) && isStr(v.id) && isStr(v.name) && isStr(v.goal) && isRecord(v.record) && isState(v.state) && isNum(v.turn)
    && allOf(v.history, isTurn) && isNum(v.retries) && allOf(v.altMethods, isAlt) && isCompletion(v.completion)
    && allOf(v.injections, isInjection) && allOf(v.steps, isPlannedStep) && isNum(v.createdAt) && isNum(v.updatedAt);
}
