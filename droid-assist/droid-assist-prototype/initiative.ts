import type { WorkflowStep } from './types.js';
import type { StageId } from './loop-control.js';
import { uid } from './planner.js';

/**
 * AI initiative: what the AI may start on its own (scan the screen, test itself, work around a
 * failure, create a workflow), and how each start is gated by the guardrails before it runs.
 */

/** Each kind of initiative; each has its own loop-control stage and auto-apply switch. */
export type InitiativeCategory = 'scan' | 'selfTest' | 'workaround' | 'workflow';
export const INITIATIVE_CATEGORIES: readonly InitiativeCategory[] = ['scan', 'selfTest', 'workaround', 'workflow'];

/** The loop-control stage that gates each category. */
export const CATEGORY_STAGE: Record<InitiativeCategory, StageId> = { scan: 'initiativeScan', selfTest: 'selfTest', workaround: 'workarounds', workflow: 'workflowCreation' };

/** Panel and log name of each category. */
export const CATEGORY_NAME: Record<InitiativeCategory, string> = { scan: 'Screen scan', selfTest: 'Self-test', workaround: 'Workaround', workflow: 'New workflow' };

/** Auto-apply per category; off means every initiative of it waits as a proposal. */
export type AutoApplyMap = Record<InitiativeCategory, boolean>;
export const DEFAULT_AUTO_APPLY: AutoApplyMap = { scan: false, selfTest: false, workaround: false, workflow: false };

/** Self-tests in the background verify only (no input); in the foreground they are highlighted and click when armed. */
export type SelfTestMode = 'background' | 'foreground';
export const SELF_TEST_MODES: readonly SelfTestMode[] = ['background', 'foreground'];

/** Range and default of the scan interval (seconds) and of the heavy element tester's cycles. */
export const SCAN_SEC_MIN = 10;
export const SCAN_SEC_MAX = 600;
export const DEFAULT_SCAN_SEC = 60;
/** Soonest the AI may ask for its next scan. */
export const AI_SCAN_SEC_MIN = 5;
export const STRESS_CYCLES_MIN = 1;
export const STRESS_CYCLES_MAX = 50;
export const DEFAULT_STRESS_CYCLES = 6;

/** Most proposals and log entries kept. */
export const INITIATIVE_PROPOSAL_LIMIT = 50;
export const INITIATIVE_LOG_LIMIT = 100;

/** A change to a workflow: a new step, a removed step, a moved step or an alternate target (1-based positions). */
export type WorkflowEdit =
  | { kind: 'add'; at: number; step: WorkflowStep }
  | { kind: 'remove'; at: number }
  | { kind: 'reorder'; from: number; to: number }
  | { kind: 'retarget'; at: number; x: number; y: number; target?: string };
export type WorkflowEditKind = WorkflowEdit['kind'];
export const WORKFLOW_EDIT_KINDS: readonly WorkflowEditKind[] = ['add', 'remove', 'reorder', 'retarget'];

/** A proposed new workflow: a successful sequence, verified by agents before it is proposed. */
export interface WorkflowPack {
  name: string;
  description: string;
  steps: WorkflowStep[];
  /** One line per verified step, from the agent's dry-run replay. */
  checks: string[];
}

export type InitiativeStatus = 'pending' | 'applied' | 'dismissed';
export const INITIATIVE_STATUSES: readonly InitiativeStatus[] = ['pending', 'applied', 'dismissed'];

/** One thing the AI wants to do: a step (scan, self-test), a workflow edit (workaround) or a pack (workflow). */
export interface InitiativeProposal {
  id: string;
  time: number;
  category: InitiativeCategory;
  text: string;
  status: InitiativeStatus;
  step?: WorkflowStep;
  edits?: WorkflowEdit[];
  pack?: WorkflowPack;
}

/** One logged initiative event: what was proposed, applied, refused or measured. */
export interface InitiativeEntry {
  id: string;
  time: number;
  category: InitiativeCategory;
  text: string;
  ok: boolean;
}

/** The heavy element tester's measurement of one element. */
export interface StressReport {
  id: string;
  time: number;
  target: string;
  attempts: number;
  succeeded: number;
  /** succeeded / attempts. */
  reliability: number;
  /** Successes and attempts per input kind. */
  byAction: Partial<Record<WorkflowStep['action'], { ok: number; total: number }>>;
  dryRun: boolean;
}

/** Everything the initiative layer persists. */
export interface InitiativeState {
  proposals: InitiativeProposal[];
  log: InitiativeEntry[];
  stress: StressReport[];
}
export const EMPTY_INITIATIVE: InitiativeState = { proposals: [], log: [], stress: [] };
export const STRESS_LIMIT = 30;

/** What the guardrails say an initiative may do right now. */
export type Disposition = { kind: 'blocked'; reason: string } | { kind: 'propose'; reason: string } | { kind: 'apply' };

/** The guardrail state an initiative is judged against. */
export interface Guard {
  aborted: boolean;
  stageOn: boolean;
  stageOffText: string;
  autoApply: boolean;
  armed: boolean;
  /** Real input actions left in the initiative budget. */
  budgetLeft: number;
  /** Applying it sends screen input (a scan step, a foreground self-test); memory edits do not. */
  needsInput: boolean;
}

/**
 * Guardrails first: an abort or an unchecked stage blocks the initiative. Without auto-apply it
 * is a proposal; an input-sending one also stays a proposal while disarmed or out of budget.
 */
export function disposition(category: InitiativeCategory, g: Guard): Disposition {
  if (g.aborted) return { kind: 'blocked', reason: 'ABORTED is active' };
  if (!g.stageOn) return { kind: 'blocked', reason: g.stageOffText };
  if (!g.autoApply) return { kind: 'propose', reason: `auto-apply is off for ${CATEGORY_NAME[category]}` };
  if (g.needsInput && !g.armed) return { kind: 'propose', reason: 'real input is disarmed' };
  if (g.needsInput && g.budgetLeft <= 0) return { kind: 'propose', reason: 'the initiative action budget is spent' };
  return { kind: 'apply' };
}

/** The delay to the next scan in ms: the user interval, or sooner when the AI asked for it (never under AI_SCAN_SEC_MIN). */
export function nextScanDelay(userSec: number, aiSec?: number): number {
  const sec = typeof aiSec === 'number' && Number.isFinite(aiSec) ? Math.min(userSec, Math.max(AI_SCAN_SEC_MIN, aiSec)) : userSec;
  return Math.round(sec * 1000);
}

/** A step stripped of its screenshots and run state, so it can be stored with a proposal. */
export function storableStep({ refFrame: _ref, shot: _shot, beforeFrame: _before, afterFrame: _after, ...s }: WorkflowStep): WorkflowStep {
  return { ...s, status: 'pending' };
}

const proposalKey = (p: Pick<InitiativeProposal, 'category' | 'text'>) => `${p.category}:${p.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;

/** A new proposal first, unless the same category + text is already pending; returns the list and the added proposal (null when a duplicate). */
export function addProposal(list: InitiativeProposal[], draft: Omit<InitiativeProposal, 'id' | 'time' | 'status'>, time = Date.now()): { proposals: InitiativeProposal[]; added: InitiativeProposal | null } {
  if (list.some((p) => p.status === 'pending' && proposalKey(p) === proposalKey(draft))) return { proposals: list, added: null };
  const added: InitiativeProposal = { id: uid('init'), time, status: 'pending', ...draft };
  return { proposals: [added, ...list].slice(0, INITIATIVE_PROPOSAL_LIMIT), added };
}

/** Sets the status of one proposal. */
export const setStatus = (list: InitiativeProposal[], id: string, status: InitiativeStatus) => list.map((p) => (p.id === id ? { ...p, status } : p));

/** Adds a log entry first, capped at INITIATIVE_LOG_LIMIT. */
export const addEntry = (list: InitiativeEntry[], entry: Omit<InitiativeEntry, 'id' | 'time'>, time = Date.now()): InitiativeEntry[] => [{ id: uid('ilog'), time, ...entry }, ...list].slice(0, INITIATIVE_LOG_LIMIT);

const inRange = (n: number, len: number) => Number.isInteger(n) && n >= 1 && n <= len;

/** One edit applied to `steps`; null when a position is out of range. */
const EDITORS: { [K in WorkflowEditKind]: (steps: WorkflowStep[], e: Extract<WorkflowEdit, { kind: K }>) => WorkflowStep[] | null } = {
  add: (steps, e) => (Number.isInteger(e.at) && e.at >= 1 && e.at <= steps.length + 1 ? [...steps.slice(0, e.at - 1), { ...e.step, status: 'pending' }, ...steps.slice(e.at - 1)] : null),
  remove: (steps, e) => (inRange(e.at, steps.length) && steps.length > 1 ? steps.filter((_, i) => i !== e.at - 1) : null),
  reorder: (steps, e) => {
    if (!inRange(e.from, steps.length) || !inRange(e.to, steps.length) || e.from === e.to) return null;
    const next = [...steps];
    const [moved] = next.splice(e.from - 1, 1);
    next.splice(e.to - 1, 0, moved);
    return next;
  },
  retarget: (steps, e) => (inRange(e.at, steps.length) ? steps.map((s, i) => (i === e.at - 1 ? { ...s, x: e.x, y: e.y, target: e.target ?? s.target, refFrame: undefined, correctedX: undefined, correctedY: undefined } : s)) : null),
};

/** Applies `edits` in order; null when any of them does not fit the steps. */
export function applyEdits(steps: WorkflowStep[], edits: WorkflowEdit[]): WorkflowStep[] | null {
  let out: WorkflowStep[] | null = steps;
  for (const e of edits) {
    if (!out) return null;
    out = (EDITORS[e.kind] as (s: WorkflowStep[], e: WorkflowEdit) => WorkflowStep[] | null)(out, e);
  }
  return out;
}

const pos = (p: { x: number; y: number }) => `(${(p.x * 100).toFixed(1)}%, ${(p.y * 100).toFixed(1)}%)`;

/** One line describing each edit kind. */
const EDIT_TEXT: { [K in WorkflowEditKind]: (e: Extract<WorkflowEdit, { kind: K }>) => string } = {
  add: (e) => `add step ${e.at} "${e.step.name}" (${e.step.action})`,
  remove: (e) => `remove step ${e.at}`,
  reorder: (e) => `move step ${e.from} to position ${e.to}`,
  retarget: (e) => `retarget step ${e.at} to ${e.target ? `"${e.target}" ` : ''}at ${pos(e)}`,
};

/** The log text of an edit list. */
export const editsText = (edits: WorkflowEdit[]) => edits.map((e) => (EDIT_TEXT[e.kind] as (e: WorkflowEdit) => string)(e)).join('; ');
