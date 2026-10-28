import type { Frame, LearnedPattern, LogEntry, SyncLevel, WorkflowStep } from './types.js';
import { SAMPLE_VIEW, parseJsonReply, viewPoint } from './ai.js';
import type { AskFn, ViewSize } from './ai.js';
import { isPopupEntry, isPopupLine } from './attention.js';
import type { Thought } from './assist-ai.js';
import type { ThinkingEntry } from './thinking-timeline.js';
import { uid } from './planner.js';

/** A review is auto-applied only when the model reports at least this confidence. */
export const SUPERVISOR_CONFIDENCE = 0.7;
/** How long the main executor has to apply a correction before the supervisor performs it itself. */
export const SUPERVISOR_APPLY_WINDOW_MS = 5000;
/** Cadence of the periodic review while the agent is on and a plan exists. */
export const SUPERVISOR_INTERVAL_MS = 15_000;
/** How often the supervisor checks for unapplied corrections and a due review. */
export const SUPERVISOR_TICK_MS = 1000;
/** Screenshots from the gallery sent with each review. */
export const SUPERVISOR_FRAMES = 3;

/** A correction to one plan step; only the fields the model gave are set. */
export interface StepFix {
  stepId: string;
  /** 1-based position of the step when the review was made, for display. */
  index: number;
  name?: string;
  target?: string;
  text?: string;
  x?: number;
  y?: number;
  reason: string;
}

/** A habit the supervisor wants remembered for future planning. */
export interface HabitUpdate {
  kind: LearnedPattern['kind'];
  pattern: string;
}

/** The supervisor's structured ruling on the whole run. */
export interface SupervisorReview extends Thought {
  time: number;
  planOk: boolean;
  assessment: string;
  /** 0..1 as reported by the model; 0 when it reported none. */
  confidence: number;
  stepFixes: StepFix[];
  habits: HabitUpdate[];
  /** The diagnosed reason the plan is invalid; '' when none was given. */
  problem: string;
  /** The suggested strategy for the re-plan; '' when none was given. */
  strategy: string;
  /** Methods the re-plan must not repeat (blacklisted). */
  avoid: string[];
  /** Distinct "[Opportunity]" notes: actions to take as immediate next steps. */
  opportunities: string[];
}

/** Rejected re-plans in a row after which the supervisor stops the run (convergence guard). */
export const SUPERVISOR_REPLAN_LIMIT = 3;

/** Everything the supervisor consolidates for one review. */
export interface SupervisorInput {
  goal: string;
  steps: WorkflowStep[];
  log: LogEntry[];
  timeline: ThinkingEntry[];
  frames: Frame[];
  sync: { level: SyncLevel; detail: string };
  progress: { done: number; manual: number };
}

/** A correction the supervisor applied and is waiting for the executor to carry out. */
export interface PendingFix {
  stepId: string;
  appliedAt: number;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const AGENT_SOURCES = /Drift|Progress|Goal reviewer|watcher|Auto-Actor|Replay|Patterns/i;

/** Popup lines stay in the popup watcher's scope (attention.ts) and never reach the supervisor's digest. */
const isAgentLine = (l: LogEntry) => AGENT_SOURCES.test(l.source) && !isPopupEntry(l);

function stepLine(s: WorkflowStep, i: number): string {
  const at = `(${pct(s.correctedX ?? s.x)}, ${pct(s.correctedY ?? s.y)})`;
  const drift = s.drift === undefined ? '' : `, drift ${s.drift.toFixed(3)}`;
  return `${i + 1}. ${s.action} "${s.target ?? s.name}"${s.text ? ` text "${s.text}"` : ''} at ${at} — ${s.status}${drift}`;
}

function timelineLine(e: ThinkingEntry): string {
  return `[${e.kind}] ${e.step}: ${e.error ? `FAILED ${e.error}` : e.text}`;
}

/** The consolidated text the supervisor sends: plan, agent outputs, sync, progress and thinking. */
export function supervisorDigest(input: SupervisorInput): string {
  const agentLines = input.log.filter(isAgentLine).slice(0, 12).map((l) => `[${l.source}] ${l.message}`);
  const steps = input.steps.map(stepLine);
  const thinking = input.timeline.map(timelineLine).filter((l) => !isPopupLine(l)).slice(0, 12);
  return [
    `Goal: ${input.goal || '(none)'}`,
    `Plan (${steps.length} step(s)):`,
    ...(steps.length ? steps : ['(empty)']),
    `Drift monitor sync: ${input.sync.level} — ${input.sync.detail}`,
    `Progress tracker: ${input.progress.done} verified step(s), ${input.progress.manual} manual`,
    'Agent outputs (drift, goal reviews, watcher notes), newest first:',
    ...(agentLines.length ? agentLines : ['(none)']),
    'Thinking timeline, newest first:',
    ...(thinking.length ? thinking : ['(none)']),
    `Screenshots attached: the ${Math.min(SUPERVISOR_FRAMES, input.frames.length)} most recent gallery frame(s), newest first.`,
  ].join('\n');
}

const optionalText = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** One step fix from the reply; null when it names no existing step. */
function toFix(raw: unknown, steps: WorkflowStep[], view: ViewSize): StepFix | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const index = Number(r.step);
  if (!Number.isInteger(index) || index < 1 || index > steps.length) return null;
  const point = r.x !== undefined && r.x !== null && r.y !== undefined && r.y !== null ? viewPoint(r.x, r.y, view) : {};
  const fields = { name: optionalText(r.name), target: optionalText(r.target), text: optionalText(r.text) };
  const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  return { stepId: steps[index - 1].id, index, ...set, ...point, reason: String(r.reason ?? '') };
}

function toHabit(raw: unknown): HabitUpdate | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pattern = optionalText(r.pattern);
  return pattern && (r.kind === 'avoid' || r.kind === 'add') ? { kind: r.kind, pattern } : null;
}

/** The assessment of a review whose reply gave none: said plainly, with confidence 0 so nothing is auto-applied. */
export const NO_ASSESSMENT = 'No assessment could be produced';

/**
 * Reads the review JSON; a missing assessment is stated plainly (NO_ASSESSMENT, confidence 0), never made up.
 * Pixel coordinates in step fixes are read in the `view` the screenshots were sent at.
 */
export function parseReview(content: string, thinking: string | null, steps: WorkflowStep[], now = Date.now(), view: ViewSize = SAMPLE_VIEW): SupervisorReview {
  const r = parseJsonReply(content);
  const given = optionalText(r.assessment);
  const assessment = given ?? NO_ASSESSMENT;
  const c = given && typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
  const stepFixes = (Array.isArray(r.step_fixes) ? r.step_fixes : []).map((f) => toFix(f, steps, view)).filter((f): f is StepFix => f !== null);
  const habits = (Array.isArray(r.habits) ? r.habits : []).map(toHabit).filter((h): h is HabitUpdate => h !== null);
  const problem = optionalText(r.problem) ?? '';
  const strategy = optionalText(r.strategy) ?? '';
  const opportunities = unique([...textList(r.opportunities), ...[assessment, strategy, thinking ?? ''].flatMap(opportunityNotes)]);
  return { time: now, planOk: r.plan_ok === true, assessment, confidence: c, stepFixes, habits, thinking, problem, strategy, avoid: unique(textList(r.avoid)), opportunities };
}

const OPPORTUNITY = /\[Opportunity\]\s*([^\n[]+)/gi;

/** The text of every "[Opportunity] …" note in `text`, up to the line end or the next bracketed tag. */
export function opportunityNotes(text: string): string[] {
  return [...text.matchAll(OPPORTUNITY)].map((m) => m[1].trim()).filter(Boolean);
}

/** The non-empty trimmed strings of a reply array; anything else is []. */
function textList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(optionalText).filter((s): s is string => s !== undefined) : [];
}

/** First occurrence of each entry, compared case-insensitively. */
function unique(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((s) => !seen.has(s.toLowerCase()) && Boolean(seen.add(s.toLowerCase())));
}

/** What the run does with a review: carry on, re-plan with its feedback, or halt after `limit` rejected re-plans. */
export function reviewDecision(review: SupervisorReview, replans: number, limit = SUPERVISOR_REPLAN_LIMIT): 'ok' | 'replan' | 'halt' {
  if (review.planOk) return 'ok';
  return replans >= limit ? 'halt' : 'replan';
}

/** The review's feedback for the planner: diagnosed problem, strategy, blacklisted methods and opportunities. */
export function replanFeedback(review: SupervisorReview): string {
  return [
    `Supervisor rejected the plan: ${review.problem || review.assessment}`,
    review.strategy && `Suggested strategy: ${review.strategy}`,
    review.avoid.length > 0 && `Blacklisted — do not repeat: ${review.avoid.join('; ')}`,
    review.opportunities.length > 0 && `Opportunities to take as the next steps: ${review.opportunities.join('; ')}`,
  ].filter(Boolean).join('\n');
}

/** The stop message when the guard trips: the goal cannot proceed, and the last diagnosed reason why. */
export function haltText(goal: string, review: SupervisorReview, replans: number): string {
  return `Goal "${goal}" cannot proceed — the supervisor rejected ${replans} consecutive re-plan(s). Last diagnosis: ${review.problem || review.assessment}`;
}

/** The one structured supervisor question: is the plan/coordinate set still right, and what should change? */
export async function reviewRun(ask: AskFn, input: SupervisorInput): Promise<SupervisorReview> {
  const [frame, ...rest] = input.frames.slice(0, SUPERVISOR_FRAMES);
  const reply = await ask({
    system: (view) => `You are Droid Assist's supervisor. You review every other agent, the screenshots and the model's thinking, then rule on the plan. The first screenshot is the newest. Coordinates are fractions 0..1 of the screenshot (${view.w}x${view.h}). Reply ONLY with JSON {"plan_ok":boolean,"assessment":string,"confidence":number,"step_fixes":[{"step":number,"x":number,"y":number,"target":string,"name":string,"text":string,"reason":string}],"habits":[{"kind":"avoid"|"add","pattern":string}],"problem":string,"strategy":string,"avoid":[string],"opportunities":[string]} where step is the 1-based step number, confidence is 0..1, and you omit any field you would not change. When plan_ok is false, problem says why the plan is invalid, strategy how to re-plan, avoid the methods that must not be repeated, and opportunities the actions to take next (also written as "[Opportunity] …" notes).`,
    prompt: `${supervisorDigest(input)}\n\nGiven all this, is the current plan and coordinate set still correct, and what final updates should be applied?`,
    frame: frame ?? null,
    frames: rest,
    json: true,
  });
  return parseReview(reply.content, reply.thinking, input.steps, Date.now(), reply.view);
}

/** True when the review may be applied without the user: confident and it actually suggests something. */
export function isConfident(review: SupervisorReview): boolean {
  return review.confidence >= SUPERVISOR_CONFIDENCE && review.stepFixes.length + review.habits.length > 0;
}

/** What the Supervisor panel shows. */
export interface SupervisorState {
  status: 'idle' | 'reviewing' | 'done' | 'offline' | 'error';
  detail: string;
  review: SupervisorReview | null;
  /** Whether the last review's updates were auto-applied. */
  applied: boolean;
}

/** One-line summary of a review for the timeline and the log. */
export function reviewText(r: SupervisorReview, applied: boolean): string {
  const fixes = r.stepFixes.length ? ` · ${r.stepFixes.length} step fix(es) ${applied ? 'applied' : 'suggested'}` : '';
  const habits = r.habits.length ? ` · ${r.habits.length} habit update(s)${applied ? '' : ' suggested'}` : '';
  return `${r.planOk ? 'Plan OK' : 'Plan needs updates'} (confidence ${r.confidence.toFixed(2)}) — ${r.assessment}${fixes}${habits}`;
}

/** The step with the fix applied: a moved target drops its stale drift correction and runs again. */
export function applyFix(step: WorkflowStep, fix: StepFix): WorkflowStep {
  const fields = { name: fix.name, target: fix.target, text: fix.text };
  const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  const moved = fix.x !== undefined && fix.y !== undefined ? { x: fix.x, y: fix.y, correctedX: undefined, correctedY: undefined, drift: undefined, driftPx: undefined } : {};
  return { ...step, ...set, ...moved, status: 'pending' };
}

/** Applies every fix to its step by id; steps without a fix are returned unchanged. */
export function applyFixes(steps: WorkflowStep[], fixes: StepFix[]): WorkflowStep[] {
  return steps.map((s) => fixes.filter((f) => f.stepId === s.id).reduce(applyFix, s));
}

/** The habit updates as learned patterns for the planner. */
export function habitPatterns(habits: HabitUpdate[], goal: string, now = Date.now()): LearnedPattern[] {
  return habits.map((h) => ({ id: uid('pat'), kind: h.kind, pattern: h.pattern, context: goal, time: now }));
}

/** Pending fixes whose step still exists, is not done and has waited out the window. */
export function staleFixes(pending: PendingFix[], steps: WorkflowStep[], now: number, windowMs = SUPERVISOR_APPLY_WINDOW_MS): PendingFix[] {
  return pending.filter((p) => now - p.appliedAt >= windowMs && steps.some((s) => s.id === p.stepId && s.status !== 'done'));
}

/** What the executor is doing right now. */
export interface ExecutorState {
  autoBusy: boolean;
  replaying: boolean;
  recording: boolean;
  steps: WorkflowStep[];
}

/** True while the main executor is mid-step: the supervisor must not touch the screen. */
export function executorBusy(e: ExecutorState): boolean {
  return e.autoBusy || e.replaying || e.recording || e.steps.some((s) => s.status === 'running');
}
