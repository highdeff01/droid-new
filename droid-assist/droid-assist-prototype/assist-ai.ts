import type { Annotation, Frame, WorkflowStep } from './types.js';
import { AiError, VIEW_H, VIEW_W, parseJsonReply, toUnit } from './ai.js';
import type { AiReply, AskFn } from './ai.js';
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
const COORDS = `Coordinates are fractions 0..1 of the screenshot (${VIEW_W}x${VIEW_H}) width/height.`;
const stepText = (step: WorkflowStep) => `"${step.name}" — action ${step.action}${step.text ? ` with "${step.text}"` : ''}`;

/** The model's ruling on a changed region: close it at (x, y), or leave it. */
export type PopupDecision = ({ close: true; x: number; y: number; reason: string } | { close: false; reason: string }) & Thought;

/** Asks the model whether the flagged region is an intrusive popup and where its close control is. */
export async function decidePopup(ask: AskFn, frame: Frame, box: Box): Promise<PopupDecision> {
  const { content, thinking } = await ask({
    system: `You are Droid Assist's popup handler. Look at the screenshot. ${COORDS} Reply ONLY with JSON {"close":boolean,"x":number,"y":number,"reason":string}.`,
    prompt: `New content appeared in the region ${boxText(box)}. If it is an ad, dialog or popup that blocks the user, set close=true and give the center of its close/dismiss control. Otherwise close=false.`,
    frame,
    json: true,
  });
  const r = parseJsonReply(content);
  const reason = String(r.reason ?? '');
  if (r.close !== true) return { close: false, reason, thinking };
  return { close: true, x: toUnit(r.x, VIEW_W), y: toUnit(r.y, VIEW_H), reason, thinking };
}

/** The model's ruling on the next step: run it now (at a possibly corrected target) or wait. */
export type StepDecision = ({ run: true; x: number; y: number; reason: string } | { run: false; reason: string }) & Thought;

/** Asks the model whether the screen is ready for `step` and where its target is now. */
export async function decideStep(ask: AskFn, frame: Frame, step: WorkflowStep, goal: string): Promise<StepDecision> {
  const target = `(${pct(step.correctedX ?? step.x)}, ${pct(step.correctedY ?? step.y)})`;
  const { content, thinking } = await ask({
    system: `You are Droid Assist's executor. Look at the screenshot and decide whether the next step can run now. ${COORDS} Reply ONLY with JSON {"run":boolean,"x":number,"y":number,"reason":string}.`,
    prompt: `Goal: ${goal || '(none)'}\nNext step: ${stepText(step)}, planned target ${target}.\nSet run=true only if the screen is ready for it, with x,y the target's current center. Set run=false if something blocks it or the screen is not ready.`,
    frame,
    json: true,
  });
  const r = parseJsonReply(content);
  const reason = String(r.reason ?? '');
  if (r.run !== true) return { run: false, reason, thinking };
  return { run: true, x: toUnit(r.x ?? step.x, VIEW_W), y: toUnit(r.y ?? step.y, VIEW_H), reason, thinking };
}

/** The model's answer about the screen plus the items it points out. */
export interface ScreenAnswer extends Thought {
  answer: string;
  annotations: Annotation[];
}

const TONES = new Set<Annotation['tone']>(['info', 'warn', 'error']);

function toAnnotation(raw: unknown): Annotation {
  const a = (raw ?? {}) as Record<string, unknown>;
  const tone = TONES.has(a.tone as Annotation['tone']) ? (a.tone as Annotation['tone']) : 'info';
  return { id: uid('ann'), x: toUnit(a.x, VIEW_W), y: toUnit(a.y, VIEW_H), w: toUnit(a.w ?? 0.1, VIEW_W), h: toUnit(a.h ?? 0.08, VIEW_H), label: String(a.label ?? ''), tone };
}

/** AI help: answers `question` from the live screen and boxes what it refers to. */
export async function describeScreen(ask: AskFn, frame: Frame, question: string, goal: string): Promise<ScreenAnswer> {
  const { content, thinking } = await ask({
    system: `You are Droid Assist, a helper that sees the user's screen. ${COORDS} Reply ONLY with JSON {"answer":string,"items":[{"label":string,"x":number,"y":number,"w":number,"h":number,"tone":"info"|"warn"|"error"}]} where items box the on-screen things your answer refers to (x,y = top-left).`,
    prompt: `Goal: ${goal || '(none)'}\nQuestion: ${question}`,
    frame,
    json: true,
  });
  const r = parseJsonReply(content);
  if (typeof r.answer !== 'string' || !r.answer.trim()) throw new AiError('AI reply had no answer');
  const items = Array.isArray(r.items) ? r.items : [];
  return { answer: r.answer.trim(), annotations: items.map(toAnnotation), thinking };
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

/**
 * Reflect-after-step: first asks the model to reflect in free text on the executed step and the
 * screen after it, then asks for the final JSON verdict {success, pattern_avoid, pattern_add}.
 */
export async function reflectStep(ask: AskFn, frame: Frame | null, step: WorkflowStep, result: StepResult, goal: string): Promise<StepReflection> {
  const facts = `Goal: ${goal || '(none)'}\nStep: ${stepText(step)}\nExecution result: ${result.ok ? 'reported ok' : 'reported failure'} — ${result.message}`;
  const first = await ask({
    system: 'You are Droid Assist reviewing a step it just executed. The screenshot shows the screen after the step. Reflect briefly in plain text: did the step achieve its purpose, and what should be done differently next time?',
    prompt: facts,
    frame,
  });
  const second = await ask({
    system: 'You are Droid Assist giving the final verdict on an executed step. Reply ONLY with JSON {"success":boolean,"pattern_avoid":string|null,"pattern_add":string|null} where pattern_avoid is a behaviour to avoid next time and pattern_add a behaviour to add, or null.',
    prompt: `${facts}\nYour reflection: ${first.content}`,
    frame,
    json: true,
  });
  return { reflection: { text: first.content, thinking: first.thinking }, verdict: parseVerdict(second) };
}
