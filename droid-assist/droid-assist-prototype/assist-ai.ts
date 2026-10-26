import type { Annotation, Frame, WorkflowStep } from './types.js';
import { AiError, VIEW_H, VIEW_W, parseJsonReply, toUnit } from './ai.js';
import type { AskFn } from './ai.js';
import { uid } from './planner.js';

/** A normalized box on the screen. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const boxText = (b: Box) => `x=${pct(b.x)}..${pct(b.x + b.w)}, y=${pct(b.y)}..${pct(b.y + b.h)}`;
const COORDS = `Coordinates are fractions 0..1 of the screenshot (${VIEW_W}x${VIEW_H}) width/height.`;

/** The model's ruling on a changed region: close it at (x, y), or leave it. */
export type PopupDecision = { close: true; x: number; y: number; reason: string } | { close: false; reason: string };

/** Asks the model whether the flagged region is an intrusive popup and where its close control is. */
export async function decidePopup(ask: AskFn, frame: Frame, box: Box): Promise<PopupDecision> {
  const reply = await ask({
    system: `You are Droid Assist's popup handler. Look at the screenshot. ${COORDS} Reply ONLY with JSON {"close":boolean,"x":number,"y":number,"reason":string}.`,
    prompt: `New content appeared in the region ${boxText(box)}. If it is an ad, dialog or popup that blocks the user, set close=true and give the center of its close/dismiss control. Otherwise close=false.`,
    frame,
    json: true,
  });
  const r = parseJsonReply(reply);
  const reason = String(r.reason ?? '');
  if (r.close !== true) return { close: false, reason };
  return { close: true, x: toUnit(r.x, VIEW_W), y: toUnit(r.y, VIEW_H), reason };
}

/** The model's ruling on the next step: run it now (at a possibly corrected target) or wait. */
export type StepDecision = { run: true; x: number; y: number; reason: string } | { run: false; reason: string };

/** Asks the model whether the screen is ready for `step` and where its target is now. */
export async function decideStep(ask: AskFn, frame: Frame, step: WorkflowStep, goal: string): Promise<StepDecision> {
  const target = `(${pct(step.correctedX ?? step.x)}, ${pct(step.correctedY ?? step.y)})`;
  const reply = await ask({
    system: `You are Droid Assist's executor. Look at the screenshot and decide whether the next step can run now. ${COORDS} Reply ONLY with JSON {"run":boolean,"x":number,"y":number,"reason":string}.`,
    prompt: `Goal: ${goal || '(none)'}\nNext step: "${step.name}" — action ${step.action}${step.text ? ` with "${step.text}"` : ''}, planned target ${target}.\nSet run=true only if the screen is ready for it, with x,y the target's current center. Set run=false if something blocks it or the screen is not ready.`,
    frame,
    json: true,
  });
  const r = parseJsonReply(reply);
  const reason = String(r.reason ?? '');
  if (r.run !== true) return { run: false, reason };
  return { run: true, x: toUnit(r.x ?? step.x, VIEW_W), y: toUnit(r.y ?? step.y, VIEW_H), reason };
}

/** The model's ruling on whether a step's named target is under the proposed point. */
export interface TargetCheck {
  visible: boolean;
  reason: string;
}

/**
 * The second, easier grounding question: shown a zoomed crop with a red ring on the proposed
 * point, the model only says whether `step`'s named target is under the ring.
 */
export async function confirmTarget(ask: AskFn, crop: Frame, step: WorkflowStep): Promise<TargetCheck> {
  const reply = await ask({
    system: 'You are Droid Assist\'s target checker. You see a zoomed crop of the screen; a red ring marks where the mouse will go. Reply ONLY with JSON {"visible":boolean,"reason":string}.',
    prompt: `Is "${step.target ?? step.name}" under or touching the red ring? Set visible=true only if the ring is on that exact thing, not on something else nearby or on empty space.`,
    frame: crop,
    json: true,
  });
  const r = parseJsonReply(reply);
  return { visible: r.visible === true, reason: String(r.reason ?? '') };
}

/** The model's answer about the screen plus the items it points out. */
export interface ScreenAnswer {
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
  const reply = await ask({
    system: `You are Droid Assist, a helper that sees the user's screen. ${COORDS} Reply ONLY with JSON {"answer":string,"items":[{"label":string,"x":number,"y":number,"w":number,"h":number,"tone":"info"|"warn"|"error"}]} where items box the on-screen things your answer refers to (x,y = top-left).`,
    prompt: `Goal: ${goal || '(none)'}\nQuestion: ${question}`,
    frame,
    json: true,
  });
  const r = parseJsonReply(reply);
  if (typeof r.answer !== 'string' || !r.answer.trim()) throw new AiError('AI reply had no answer');
  const items = Array.isArray(r.items) ? r.items : [];
  return { answer: r.answer.trim(), annotations: items.map(toAnnotation) };
}
