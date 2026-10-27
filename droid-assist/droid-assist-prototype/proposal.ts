import type { StepAction, WorkflowStep } from './types.js';
import { POINTER_ACTIONS } from './types.js';
import { AiError, SAMPLE_VIEW, parseJsonReply, toUnit } from './ai.js';
import type { AskFn, ViewSize } from './ai.js';
import type { Thought } from './assist-ai.js';
import type { ChangeAssessment } from './screen-change.js';
import type { Frame } from './types.js';

/** What the executor is about to do and why — recorded before any step is dispatched. */
export interface Proposal extends Thought {
  /** False when the model says the step cannot be justified on the current screen. */
  ready: boolean;
  action: StepAction;
  target: string;
  /** Where the step will act, as fractions 0..1 of the screen. */
  x: number;
  y: number;
  /** One sentence: the action on the target. */
  what: string;
  /** How this step serves the goal, referencing the latest screen change when there is one. */
  why: string;
  /** Whether the model made the proposal or it was built locally while the AI is offline. */
  source: 'ai' | 'local';
  /** Not ready: how long the model estimates it must wait, in ms, when it gave one. */
  waitMs?: number;
}

/** What a proposal is justified against. */
export interface ProposalContext {
  goal: string;
  /** The latest screen-change assessment made after the plan, or null when the screen has not changed since. */
  change: ChangeAssessment | null;
  /** Learned habit/pattern lines relevant to the goal. */
  patterns: string[];
  /** Set on a re-proposal: why the first proposal no longer holds (drift red, plan stale, not ready). */
  redo?: string;
  /** Prior operations, elements and errors from the operation database relevant to the goal and step. */
  related?: string[];
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const targetOf = (step: WorkflowStep) => step.target ?? step.name;
const planned = (step: WorkflowStep) => ({ x: step.correctedX ?? step.x, y: step.correctedY ?? step.y });

/** The what-sentence of an action on a target at (x, y). */
export function whatText(action: StepAction, target: string, x: number, y: number, text?: string): string {
  const where = POINTER_ACTIONS.has(action) ? ` at (${pct(x)}, ${pct(y)})` : '';
  return `${action} "${target}"${text ? ` with "${text}"` : ''}${where}`;
}

/** Prefixes `why` with the screen change when there is one, so the proposal always references it. */
function withChange(change: ChangeAssessment | null, what: string, why: string): string {
  return change ? `The screen now shows ${change.summary}, so I will ${what}: ${why}` : why;
}

/** The proposal system prompt for a `view`-sized screenshot. */
export const proposeSystem = (view: ViewSize) => `You are Droid Assist's executor. Before running the next step you state WHAT you will do and WHY. Look at the screenshot. Coordinates are fractions 0..1 of the screenshot (${view.w}x${view.h}) width/height. Reply ONLY with JSON {"ready":boolean,"x":number,"y":number,"why":string}.`;

/** The proposal system prompt for a sample-space (480x270) screenshot. */
export const PROPOSE_SYSTEM = proposeSystem(SAMPLE_VIEW);

/** The prompt a proposal is asked with: goal, step, planned target, latest change, patterns and any redo reason. */
function proposePrompt(step: WorkflowStep, ctx: ProposalContext): string {
  const p = planned(step);
  const lines = [
    `Goal: ${ctx.goal || '(none)'}`,
    `Next step: "${step.name}" — ${whatText(step.action, targetOf(step), p.x, p.y, step.text)} (planned target)`,
    ctx.change ? `The screen changed since the plan: ${ctx.change.summary} (${ctx.change.stale ? 'judged to make the plan stale' : 'judged not to affect the plan'}${ctx.change.effect ? `: ${ctx.change.effect}` : ''}).` : 'The screen has not materially changed since the plan.',
    ...(ctx.patterns.length ? ['Learned habits/patterns:', ...ctx.patterns] : []),
    ...(ctx.related?.length ? ['Prior operations on this (from the operation database):', ...ctx.related] : []),
    ...(ctx.redo ? [`This is a RE-PROPOSAL: ${ctx.redo}. Find where the target is now, or set ready=false if the step can no longer be justified.`] : []),
    'Set ready=true only if this step serves the goal on the current screen, with x,y the target\'s current center; "why" says in one or two sentences how the step serves the goal.',
    'When ready=false because something is still loading or happening, "why" says what you are waiting on and you may add "waitMs": your estimate of how long it takes, in ms.',
  ];
  return lines.join('\n');
}

/** Asks the model for the what/why of `step` on the live frame (null before the first frame is captured). */
export async function proposeStep(ask: AskFn, frame: Frame | null, step: WorkflowStep, ctx: ProposalContext): Promise<Proposal> {
  const { content, thinking, view = SAMPLE_VIEW } = await ask({ system: proposeSystem, prompt: proposePrompt(step, ctx), frame, json: true });
  const r = parseJsonReply(content);
  const why = typeof r.why === 'string' ? r.why.trim() : '';
  if (!why) throw new AiError('AI proposal had no "why"');
  const p = planned(step);
  const pointer = POINTER_ACTIONS.has(step.action);
  const x = pointer && r.x !== undefined ? toUnit(r.x, view.w) : p.x;
  const y = pointer && r.y !== undefined ? toUnit(r.y, view.h) : p.y;
  const what = whatText(step.action, targetOf(step), x, y, step.text);
  const waitMs = r.ready !== true && typeof r.waitMs === 'number' && Number.isFinite(r.waitMs) && r.waitMs > 0 ? { waitMs: r.waitMs } : {};
  return { ready: r.ready === true, action: step.action, target: targetOf(step), x, y, what, why: withChange(ctx.change, what, why), source: 'ai', thinking, ...waitMs };
}

/** A proposal built without the model (AI offline): the planned what, with `why` stating the basis. */
export function localProposal(step: WorkflowStep, why: string, change: ChangeAssessment | null = null): Proposal {
  const p = planned(step);
  const what = whatText(step.action, targetOf(step), p.x, p.y, step.text);
  return { ready: true, action: step.action, target: targetOf(step), x: p.x, y: p.y, what, why: withChange(change, what, why), source: 'local', thinking: null };
}

/** One-line text of a proposal, for the timeline and the activity log. */
export function proposalText(p: Proposal): string {
  return `${p.ready ? '' : 'NOT READY — '}WHAT: ${p.what} · WHY: ${p.why}`;
}
