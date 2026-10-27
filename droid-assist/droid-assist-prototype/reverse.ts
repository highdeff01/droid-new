import type { ActionRecord, InputAction, WorkflowStep } from './types.js';

/** The actor name every reversal runs and is recorded under; a reversal is never itself offered for reversal. */
export const REVERSE_ACTOR = 'Reverse';

/** How to undo one performed action: the inverse steps to run, or the honest reason it cannot be undone. */
export type Reversal = { ok: true; summary: string; steps: WorkflowStep[] } | { ok: false; reason: string };

/** The newest real action and how to reverse it, as the HUD offers it. */
export interface ReverseOffer {
  record: ActionRecord;
  reversal: Reversal;
}

/** Keys whose effect another key undoes (pyautogui names, lowercase). */
const INVERSE_KEYS: Readonly<Record<string, string>> = {
  up: 'down', down: 'up', left: 'right', right: 'left',
  pageup: 'pagedown', pagedown: 'pageup', home: 'end', end: 'home',
  tab: 'shift+tab', 'shift+tab': 'tab', 'ctrl+z': 'ctrl+y', 'ctrl+y': 'ctrl+z',
};

type Point = { x: number; y: number };
type Mapper = (rec: ActionRecord, at: (x: number, y: number) => Point) => Reversal;

const cannot = (reason: string): Reversal => ({ ok: false, reason });

/** One inverse step, numbered after the record it reverses. */
const step = (rec: ActionRecord, i: number, name: string, fields: Omit<WorkflowStep, 'id' | 'name' | 'status'>): WorkflowStep =>
  ({ id: `rev-${rec.id}-${i}`, name: `Reverse: ${name}`, status: 'pending', ...fields });

const prevPoint = (rec: ActionRecord, at: (x: number, y: number) => Point): Point | null =>
  typeof rec.prevX === 'number' && typeof rec.prevY === 'number' ? at(rec.prevX, rec.prevY) : null;

/** A drag is undone by dragging from where it released back to its recorded start point. */
const reverseDrag: Mapper = (rec, at) => {
  if (typeof rec.endX !== 'number' || typeof rec.endY !== 'number') return cannot('the drag has no recorded release point');
  const from = at(rec.endX, rec.endY);
  const to = at(rec.x, rec.y);
  return { ok: true, summary: `drag back from (${rec.endX}, ${rec.endY})px to (${rec.x}, ${rec.y})px`, steps: [step(rec, 0, 'drag back to start', { action: 'drag', x: from.x, y: from.y, endX: to.x, endY: to.y })] };
};

/** A click is undone by clicking the previously-focused point, or the original target when none was recorded. */
const reverseClick: Mapper = (rec, at) => {
  const prev = prevPoint(rec, at);
  const p = prev ?? at(rec.x, rec.y);
  const where = prev ? `previously-focused point (${rec.prevX}, ${rec.prevY})px` : `original target (${rec.x}, ${rec.y})px`;
  return { ok: true, summary: `click the ${where}`, steps: [step(rec, 0, `click ${prev ? 'previous focus' : 'original target'}`, { action: 'click', x: p.x, y: p.y })] };
};

/** A hover is undone by moving back to where the pointer was; without that point there is nothing to return to. */
const reverseMove: Mapper = (rec, at) => {
  const prev = prevPoint(rec, at);
  if (!prev) return cannot('the pointer position before the move was not recorded');
  return { ok: true, summary: `move the pointer back to (${rec.prevX}, ${rec.prevY})px`, steps: [step(rec, 0, 'move back', { action: 'move', x: prev.x, y: prev.y })] };
};

/** Typing is undone by selecting the field and retyping its prior text, or by one backspace per typed character when the prior text is unknown. */
const reverseType: Mapper = (rec, at) => {
  const typed = rec.text ?? '';
  const p = at(rec.x, rec.y);
  const key = (i: number, name: string, combo: string, repeat?: number) => step(rec, i, name, { action: 'key', x: p.x, y: p.y, text: combo, ...(repeat ? { repeat } : {}) });
  if (typeof rec.priorText === 'string') {
    const restore = rec.priorText
      ? step(rec, 1, `retype "${rec.priorText}"`, { action: 'type', x: p.x, y: p.y, text: rec.priorText })
      : key(1, 'clear the field', 'backspace');
    return { ok: true, summary: `select the field and restore its prior text "${rec.priorText}"`, steps: [key(0, 'select the field', 'ctrl+a'), restore] };
  }
  if (!typed) return cannot('no typed text was recorded');
  return { ok: true, summary: `press backspace ${typed.length} time(s) to erase "${typed}" (prior text unknown)`, steps: [key(0, `erase ${typed.length} character(s)`, 'backspace', typed.length)] };
};

/** A key press is undone only by its known inverse key. */
const reverseKey: Mapper = (rec, at) => {
  const combo = (rec.text ?? '').trim().toLowerCase();
  const inverse = INVERSE_KEYS[combo];
  if (!inverse) return cannot(`key "${rec.text ?? ''}" has no known inverse`);
  const p = at(rec.x, rec.y);
  return { ok: true, summary: `press ${inverse} to undo ${combo}`, steps: [step(rec, 0, `press ${inverse}`, { action: 'key', x: p.x, y: p.y, text: inverse })] };
};

/** A scroll is undone by scrolling the opposite direction at the same point (the bridge scrolls down unless told "up"). */
const reverseScroll: Mapper = (rec, at) => {
  const opposite = /^\s*up\s*$/i.test(rec.text ?? '') ? 'down' : 'up';
  const p = at(rec.x, rec.y);
  return { ok: true, summary: `scroll ${opposite} at (${rec.x}, ${rec.y})px`, steps: [step(rec, 0, `scroll ${opposite}`, { action: 'scroll', x: p.x, y: p.y, text: opposite })] };
};

const MAPPERS: Record<InputAction, Mapper> = {
  drag: reverseDrag,
  click: reverseClick,
  double_click: reverseClick,
  move: reverseMove,
  type: reverseType,
  key: reverseKey,
  scroll: reverseScroll,
};

/** The inverse of one performed action as steps in normalized coordinates, or why it cannot be reversed. */
export function reverseAction(rec: ActionRecord): Reversal {
  if (!rec.ok) return cannot('the action did not complete');
  const { srcW, srcH } = rec;
  if (!srcW || !srcH) return cannot('the screen size of the action was not recorded');
  return MAPPERS[rec.action](rec, (x, y) => ({ x: x / srcW, y: y / srcH }));
}

/** The newest history record when it is a real action (not itself a reversal), with its reversal; null when there is nothing to offer. */
export function reverseOffer(history: readonly ActionRecord[]): ReverseOffer | null {
  const record = history[0];
  if (!record || record.source === REVERSE_ACTOR) return null;
  return { record, reversal: reverseAction(record) };
}
