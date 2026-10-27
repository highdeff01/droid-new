import { SAMPLE_VIEW, parseJsonReply, toUnit } from './ai.js';
import type { AskFn, ViewSize } from './ai.js';
import { matchTemplate } from './drift.js';
import { uid } from './planner.js';
import type { Frame, StepAction, WorkflowStep } from './types.js';
import type { ParallelSpec, TrackedPoint } from './wake-decision.js';

/** How often a running context workflow looks at the live screen. */
export const CONTEXT_TICK_MS = 2000;
/** Most context workflows kept (running and stopped). */
export const CONTEXT_LIMIT = 10;

/** Why a context workflow ended. */
export type ContextStop = 'user' | 'abort' | 'goal';

/**
 * A parallel context workflow: keeps `subject` within `maxDistance` (fraction of screen width) of
 * `anchor`, tracked on every frame; the AI decides each corrective move only when it is too far.
 */
export interface ContextWorkflow extends ParallelSpec {
  id: string;
  /** Who started it: the AI after a wake, or an agent. */
  by: string;
  /** The operation goal it was started under; a different goal ends it. */
  parentGoal: string;
  /** The frame the subject and anchor positions were last located on (template for the next match). */
  ref: Frame;
  /** Last measured subject–anchor distance. */
  distance: number;
  moves: number;
  running: boolean;
  stopped?: ContextStop;
  time: number;
}

/** Input actions the AI may choose to bring the subject back. */
const MOVE_ACTIONS: readonly StepAction[] = ['click', 'double_click', 'move', 'drag', 'key', 'type'];

/** A new running context workflow from a parallel decision, located on `frame`. */
export function startContext(spec: ParallelSpec, frame: Frame, by: string, parentGoal: string): ContextWorkflow {
  return { ...spec, id: uid('ctx'), by, parentGoal, ref: frame, distance: distanceOn(spec.subject, spec.anchor, frame), moves: 0, running: true, time: Date.now() };
}

/** Subject–anchor distance as a fraction of the screen width (height scaled by the aspect ratio). */
export function distanceOn(a: TrackedPoint, b: TrackedPoint, frame: Frame): number {
  return Math.hypot(a.x - b.x, (a.y - b.y) * (frame.srcH / frame.srcW));
}

/** Where `p` (located on `ref`) is on `live`, by template matching around its last position. */
export function relocate(p: TrackedPoint, ref: Frame, live: Frame): TrackedPoint {
  const r = matchTemplate(ref.data, live.data, p.x, p.y);
  return { ...p, x: Math.min(1, Math.max(0, p.x + r.dx)), y: Math.min(1, Math.max(0, p.y + r.dy)) };
}

/** The workflow re-located on `live`: new positions, distance and template frame. */
export function track(wf: ContextWorkflow, live: Frame): ContextWorkflow {
  const subject = relocate(wf.subject, wf.ref, live);
  const anchor = relocate(wf.anchor, wf.ref, live);
  return { ...wf, subject, anchor, ref: live, distance: distanceOn(subject, anchor, live) };
}

/** Whether the subject has drifted beyond the limit. */
export const tooFar = (wf: ContextWorkflow) => wf.distance > wf.maxDistance;

/** Why a running workflow must stop now, or null: an abort, or the operation goal changed. */
export function stopReason(wf: ContextWorkflow, goal: string, aborted: boolean): ContextStop | null {
  if (aborted) return 'abort';
  return goal.trim() === wf.parentGoal.trim() ? null : 'goal';
}

/** The workflow ended for `why`. */
export const stopContext = (wf: ContextWorkflow, why: ContextStop): ContextWorkflow => ({ ...wf, running: false, stopped: why });

/** System prompt of a corrective move for a `view`-sized screenshot. */
export const moveSystem = (view: ViewSize) => `You are a Droid Assist parallel context workflow. The subject has drifted too far from its anchor; decide ONE input action that brings it back close. Coordinates are fractions 0..1 of the screenshot (${view.w}x${view.h}) width/height.
Reply ONLY with JSON {"action":"click"|"double_click"|"move"|"drag"|"key"|"type","x":number,"y":number,"endX":number,"endY":number,"text":string,"why":string}, or {"action":"none","why":string} when no action helps now. A drag presses at x,y and releases at endX,endY.`;

/** The AI's corrective move: the step to run (null when it chose none) and why. */
export interface ContextMove {
  step: WorkflowStep | null;
  why: string;
  thinking: string | null;
}

const at = (p: TrackedPoint) => `(${(p.x * 100).toFixed(0)}%, ${(p.y * 100).toFixed(0)}%)`;

/** The prompt of a corrective move: the goal, both positions, the distance and the limit. */
const movePrompt = (wf: ContextWorkflow) => [
  `Parallel workflow goal: ${wf.goal}`,
  `Subject "${wf.subject.name}" is at ${at(wf.subject)}; anchor "${wf.anchor.name}" is at ${at(wf.anchor)}.`,
  `Distance ${(wf.distance * 100).toFixed(0)}% of the screen width exceeds the limit of ${(wf.maxDistance * 100).toFixed(0)}%.`,
].join('\n');

/** The step of a move reply; null for "none" or an action that is not input. */
function moveStep(r: Record<string, unknown>, wf: ContextWorkflow, view: ViewSize): WorkflowStep | null {
  const action = r.action as StepAction;
  if (!MOVE_ACTIONS.includes(action)) return null;
  const x = r.x === undefined ? wf.subject.x : toUnit(r.x, view.w);
  const y = r.y === undefined ? wf.subject.y : toUnit(r.y, view.h);
  const end = action === 'drag' ? { endX: r.endX === undefined ? wf.anchor.x : toUnit(r.endX, view.w), endY: r.endY === undefined ? wf.anchor.y : toUnit(r.endY, view.h), endTarget: wf.anchor.name } : {};
  const text = typeof r.text === 'string' && r.text ? { text: r.text } : {};
  return { id: uid('ctxstep'), name: `Keep ${wf.subject.name} close`, action, target: wf.subject.name, x, y, ...end, ...text, status: 'pending' };
}

/** Asks the AI for one corrective move on the live frame. */
export async function askMove(ask: AskFn, wf: ContextWorkflow): Promise<ContextMove> {
  const { content, thinking, view = SAMPLE_VIEW } = await ask({ system: moveSystem, prompt: movePrompt(wf), frame: wf.ref, json: true });
  const r = parseJsonReply(content);
  const why = typeof r.why === 'string' && r.why.trim() ? r.why.trim() : '(no reason given)';
  return { step: moveStep(r, wf, view), why, thinking };
}

/** What one tick did: the re-tracked workflow and, when it was too far, the AI's move. */
export interface ContextTick {
  wf: ContextWorkflow;
  move: ContextMove | null;
}

/** One tick: track on `live`; only when the subject is too far is the AI asked for a move. */
export async function contextTick(wf: ContextWorkflow, live: Frame, ask: AskFn): Promise<ContextTick> {
  const next = track(wf, live);
  return { wf: next, move: tooFar(next) ? await askMove(ask, next) : null };
}

/** One-line status of a workflow, for the panel and log. */
export function contextText(wf: ContextWorkflow): string {
  const state = wf.running ? 'running' : `stopped (${wf.stopped})`;
  return `${wf.goal} — "${wf.subject.name}" ${(wf.distance * 100).toFixed(0)}% from "${wf.anchor.name}" (limit ${(wf.maxDistance * 100).toFixed(0)}%), ${wf.moves} move(s), ${state}`;
}
