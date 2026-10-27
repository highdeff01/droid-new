import type { DispatchState } from './safety.js';
import type { WorkflowStep } from './types.js';
import { keyStep, scrollStep } from './recorder.js';

/**
 * Mirror input: a gesture on the screen preview (by the user or the AI) as the workflow step the
 * real-input pipeline dispatches to the PC. Points are normalized 0..1 over the mirrored screen.
 */
export type MirrorEvent =
  | { kind: 'click'; x: number; y: number }
  | { kind: 'double_click'; x: number; y: number }
  | { kind: 'drag'; x: number; y: number; endX: number; endY: number }
  | { kind: 'scroll'; x: number; y: number; deltaY: number }
  | { kind: 'key'; combo: string }
  | { kind: 'type'; text: string };

/** The kinds of mirror gesture. */
export type MirrorKind = MirrorEvent['kind'];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const pointName = (x: number, y: number) => `(${(x * 100).toFixed(1)}%, ${(y * 100).toFixed(1)}%)`;

type StepOf<K extends MirrorKind> = (ev: Extract<MirrorEvent, { kind: K }>, id: string) => WorkflowStep;

/** One step builder per mirror gesture kind. */
const STEP_OF: { [K in MirrorKind]: StepOf<K> } = {
  click: ({ x, y }, id) => ({ id, name: `Mirror click ${pointName(x, y)}`, action: 'click', x: clamp01(x), y: clamp01(y), status: 'pending' }),
  double_click: ({ x, y }, id) => ({ id, name: `Mirror double-click ${pointName(x, y)}`, action: 'double_click', x: clamp01(x), y: clamp01(y), status: 'pending' }),
  drag: ({ x, y, endX, endY }, id) => ({ id, name: `Mirror drag ${pointName(x, y)} → ${pointName(endX, endY)}`, action: 'drag', x: clamp01(x), y: clamp01(y), endX: clamp01(endX), endY: clamp01(endY), status: 'pending' }),
  scroll: ({ x, y, deltaY }, id) => ({ ...scrollStep(id, clamp01(x), clamp01(y), deltaY), name: `Mirror scroll ${deltaY < 0 ? 'up' : 'down'}` }),
  key: ({ combo }, id) => ({ ...keyStep(id, combo), name: `Mirror press ${combo}` }),
  type: ({ text }, id) => ({ id, name: `Mirror type "${text}"`, action: 'type', x: 0.5, y: 0.5, text, status: 'pending' }),
};

/** The workflow step a mirror gesture dispatches as; points are clamped to the screen. */
export function mirrorStep(ev: MirrorEvent, id: string): WorkflowStep {
  return (STEP_OF[ev.kind] as StepOf<MirrorKind>)(ev, id);
}

/** What the preview does with input right now, for the HUD badge. */
export interface MirrorMode {
  interactive: boolean;
  real: boolean;
  label: string;
}

/**
 * The mirror mode: off is a passive preview; on dispatches through the real-input pipeline —
 * LIVE only when that pipeline really reaches the PC, otherwise a labeled dry run with its reason.
 */
export function mirrorMode(on: boolean, dispatch: DispatchState): MirrorMode {
  if (!on) return { interactive: false, real: false, label: 'Mirror off — passive preview' };
  if (dispatch.real) return { interactive: true, real: true, label: 'Mirror LIVE — input goes to the PC' };
  return { interactive: true, real: false, label: `Mirror DRY RUN — ${dispatch.reason}` };
}
