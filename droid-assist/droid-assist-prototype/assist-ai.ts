import type { Annotation, Frame, WorkflowStep } from './types.js';
import { AiError, SAMPLE_VIEW, parseJsonReply, stripThinking, viewPoint } from './ai.js';
import type { AiReply, AskFn, ViewSize } from './ai.js';
import { gridPrompt, gridRef, replyPoint } from './grid.js';
import { uid } from './planner.js';

/** A normalized box on the screen. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The model's reasoning behind a decision; null when the response carried none. */
export interface Thought {
  thinking: string | null;
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const boxText = (b: Box) => `x=${pct(b.x)}..${pct(b.x + b.w)}, y=${pct(b.y)}..${pct(b.y + b.h)}`;
/** The coordinate contract for a `view`-sized screenshot: the grid plus how boxes are measured. */
const coords = (view: ViewSize) => `${gridPrompt(view)}\nBoxes (x,y,w,h) are fractions 0..1 of the screenshot (${view.w}x${view.h}) width/height; use the grid ranges above to measure them.`;
const stepText = (step: WorkflowStep) => `"${step.name}" — action ${step.action}${step.text ? ` with "${step.text}"` : ''}`;

/** The model's ruling on a changed region: close it at (x, y), or leave it. */
export type PopupDecision = ({ close: true; x: number; y: number; reason: string } | { close: false; reason: string }) & Thought;

/** Asks the model whether the flagged region is an intrusive popup and where its close control is. */
export async function decidePopup(ask: AskFn, frame: Frame, box: Box): Promise<PopupDecision> {
  const { content, thinking, view } = await ask({
    system: (v) => `You are Droid Assist's popup handler. Look at the screenshot. ${coords(v)} Reply ONLY with JSON {"close":boolean,"cell":string,"cx":number,"cy":number,"reason":string}.`,
    prompt: `New content appeared in the region ${boxText(box)} (from cell ${gridRef(box)}). If it is an ad, dialog or popup that blocks the user, set close=true and give the center of its close/dismiss control as cell + cx,cy. Otherwise close=false.`,
    frame,
    json: true,
  });
  const r = parseJsonReply(content);
  const reason = String(r.reason ?? '');
  if (r.close !== true) return { close: false, reason, thinking };
  return { close: true, ...replyPoint(r, undefined, view), reason, thinking };
}

/** The model's ruling on the next step: run it now (at a possibly corrected target) or wait. */
export type StepDecision = ({ run: true; x: number; y: number; reason: string } | { run: false; reason: string }) & Thought;

/** Asks the model whether the screen is ready for `step` and where its target is now. */
export async function decideStep(ask: AskFn, frame: Frame, step: WorkflowStep, goal: string): Promise<StepDecision> {
  const planned = { x: step.correctedX ?? step.x, y: step.correctedY ?? step.y };
  const target = `cell ${gridRef(planned)} = (${pct(planned.x)}, ${pct(planned.y)})`;
  const { content, thinking, view } = await ask({
    system: (v) => `You are Droid Assist's executor. Look at the screenshot and decide whether the next step can run now. ${coords(v)} Reply ONLY with JSON {"run":boolean,"cell":string,"cx":number,"cy":number,"reason":string}.`,
    prompt: `Goal: ${goal || '(none)'}\nNext step: ${stepText(step)}, planned target ${target}.\nSet run=true only if the screen is ready for it, with cell + cx,cy the target's current center. Set run=false if something blocks it or the screen is not ready.`,
    frame,
    json: true,
  });
  const r = parseJsonReply(content);
  const reason = String(r.reason ?? '');
  if (r.run !== true) return { run: false, reason, thinking };
  return { run: true, ...replyPoint(r, step, view), reason, thinking };
}

/** The model's ruling on whether a step's named target is under the proposed point. */
export interface TargetCheck extends Thought {
  visible: boolean;
  reason: string;
}

/**
 * Grounding check: shown the full live screen and a zoomed full-resolution crop around the
 * proposed point (red ring), the model says whether the step's named target is under the ring.
 */
export async function confirmTarget(ask: AskFn, live: Frame, crop: Frame, step: WorkflowStep): Promise<TargetCheck> {
  const reply = await ask({
    system: 'You are Droid Assist\'s target checker. The first image is the full screen; the second is a zoomed crop of the full-resolution screen around where the mouse will go, marked by a red ring. Reply ONLY with JSON {"visible":boolean,"reason":string}.',
    prompt: `Is "${step.target ?? step.name}" under or touching the red ring in the zoomed crop? Set visible=true only if the ring is on that exact thing, not on something else nearby or on empty space.`,
    frame: live,
    crops: [crop],
    json: true,
  });
  const r = parseJsonReply(reply.content);
  return { visible: r.visible === true, reason: String(r.reason ?? ''), thinking: reply.thinking };
}

/** The model's answer about the screen plus the items it points out. */
export interface ScreenAnswer extends Thought {
  answer: string;
  annotations: Annotation[];
}

const TONES = new Set<Annotation['tone']>(['info', 'warn', 'error']);

/** One model box as an annotation in the sample space; pixel values are read in the `view` the model saw. */
export function toAnnotation(raw: unknown, view: ViewSize = SAMPLE_VIEW): Annotation {
  const a = (raw ?? {}) as Record<string, unknown>;
  const tone = TONES.has(a.tone as Annotation['tone']) ? (a.tone as Annotation['tone']) : 'info';
  const at = viewPoint(a.x, a.y, view);
  const size = viewPoint(a.w ?? 0.1, a.h ?? 0.08, view);
  return { id: uid('ann'), ...at, w: size.x, h: size.y, label: String(a.label ?? ''), tone };
}

/** AI help: answers `question` from the live screen and boxes what it refers to. */
export async function describeScreen(ask: AskFn, frame: Frame, question: string, goal: string): Promise<ScreenAnswer> {
  const { content, thinking, view } = await ask({
    system: (v) => `You are Droid Assist, a helper that sees the user's screen. ${coords(v)} Reply ONLY with JSON {"answer":string,"items":[{"label":string,"x":number,"y":number,"w":number,"h":number,"tone":"info"|"warn"|"error"}]} where items box the on-screen things your answer refers to (x,y = top-left).`,
    prompt: `Goal: ${goal || '(none)'}\nQuestion: ${question}`,
    frame,
    json: true,
  });
  const r = parseJsonReply(content);
  if (typeof r.answer !== 'string' || !r.answer.trim()) throw new AiError('AI reply had no answer');
  const items = Array.isArray(r.items) ? r.items : [];
  return { answer: r.answer.trim(), annotations: items.map((item) => toAnnotation(item, view)), thinking };
}

/** The model's check of the goal against the live screen after a run. */
export interface GoalCheck extends Thought {
  /** The goal is verifiably achieved on the screen. */
  complete: boolean;
  /** The last run moved the screen closer to the goal. */
  progress: boolean;
  reason: string;
}

/** One line per step of the run just finished: what it was and how it ended. */
const runLine = (s: WorkflowStep) => `- ${stepText(s)}: ${s.status}`;

/**
 * Auto-continue verification: shown the live screen and the run's steps, the model says whether
 * the goal is complete and whether the run made progress. Non-boolean fields are an AiError.
 */
export async function verifyGoal(ask: AskFn, frame: Frame | null, goal: string, ran: WorkflowStep[]): Promise<GoalCheck> {
  const reply = await ask({
    system: 'You are Droid Assist verifying whether the user\'s goal is achieved. The screenshot shows the screen now. Reply ONLY with JSON {"complete":boolean,"progress":boolean,"reason":string}: complete=true only if the screen shows the goal achieved; progress=true if the last steps moved the screen closer to it.',
    prompt: `Goal: ${goal}\nSteps just run:\n${ran.map(runLine).join('\n') || '(none)'}`,
    frame,
    json: true,
  });
  const r = parseJsonReply(reply.content);
  if (typeof r.complete !== 'boolean') throw new AiError(`AI goal check had no boolean "complete": ${String(r.complete)}`);
  return { complete: r.complete, progress: r.progress === true, reason: String(r.reason ?? ''), thinking: reply.thinking };
}

/** What actually happened when a step ran. */
export interface StepResult {
  ok: boolean;
  message: string;
}

/** The structured judgement of an executed step. */
export interface StepVerdict extends Thought {
  success: boolean;
  pattern_avoid: string | null;
  pattern_add: string | null;
}

/** The free-text reflection on a step followed by its structured verdict. */
export interface StepReflection {
  reflection: { text: string } & Thought;
  verdict: StepVerdict;
}

const optionalText = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Reads the verdict JSON; a missing or non-boolean `success` is an AiError, never a guess. */
export function parseVerdict(reply: AiReply): StepVerdict {
  const r = parseJsonReply(reply.content);
  if (typeof r.success !== 'boolean') throw new AiError(`AI verdict had no boolean "success": ${String(r.success)}`);
  return { success: r.success, pattern_avoid: optionalText(r.pattern_avoid), pattern_add: optionalText(r.pattern_add), thinking: reply.thinking };
}

const stepFacts = (step: WorkflowStep, result: StepResult, goal: string) =>
  `Goal: ${goal || '(none)'}\nStep: ${stepText(step)}\nExecution result: ${result.ok ? 'reported ok' : 'reported failure'} — ${result.message}`;

/** The reflect stage: the model reflects in free text on the executed step and the screen after it. */
export async function reflectOn(ask: AskFn, frame: Frame | null, step: WorkflowStep, result: StepResult, goal: string): Promise<StepReflection['reflection'] & { raw: string }> {
  const first = await ask({
    system: 'You are Droid Assist reviewing a step it just executed. The screenshot shows the screen after the step. Reflect briefly in plain text: did the step achieve its purpose, and what should be done differently next time?',
    prompt: stepFacts(step, result, goal),
    frame,
  });
  return { text: stripThinking(first.content), thinking: first.thinking, raw: first.content };
}

/** The verdict stage: given the reflection, the model gives the final JSON verdict {success, pattern_avoid, pattern_add}. */
export async function judgeStep(ask: AskFn, frame: Frame | null, step: WorkflowStep, result: StepResult, goal: string, reflection: string): Promise<StepVerdict> {
  const second = await ask({
    system: 'You are Droid Assist giving the final verdict on an executed step. Reply ONLY with JSON {"success":boolean,"pattern_avoid":string|null,"pattern_add":string|null} where pattern_avoid is a behaviour to avoid next time and pattern_add a behaviour to add, or null.',
    prompt: `${stepFacts(step, result, goal)}\nYour reflection: ${reflection}`,
    frame,
    json: true,
  });
  return parseVerdict(second);
}

/**
 * Reflect-after-step: first asks the model to reflect in free text on the executed step and the
 * screen after it, then asks for the final JSON verdict {success, pattern_avoid, pattern_add}.
 */
export async function reflectStep(ask: AskFn, frame: Frame | null, step: WorkflowStep, result: StepResult, goal: string): Promise<StepReflection> {
  const { raw, ...reflection } = await reflectOn(ask, frame, step, result, goal);
  return { reflection, verdict: await judgeStep(ask, frame, step, result, goal, raw) };
}
