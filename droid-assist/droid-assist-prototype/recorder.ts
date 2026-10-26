import type { HotkeyEvent } from './safety.js';
import type { WorkflowStep } from './types.js';

/** A recorded pause longer than this replays as this, so a coffee break never stalls a replay. */
export const MAX_STEP_DELAY_MS = 10000;

/** Wheel events in the same direction within this gap of the last one are one scroll gesture (one step). */
export const SCROLL_MERGE_MS = 400;

/** The measured human pause before a step: ms since the previous recorded input, clamped to 0..MAX_STEP_DELAY_MS. */
export function stepDelay(now: number, previous: number): number {
  return Math.min(MAX_STEP_DELAY_MS, Math.max(0, Math.round(now - previous)));
}

/** Browser modifier key names as pyautogui key names, in the order a hotkey presses them. */
const MODIFIERS: ReadonlyArray<[keyof HotkeyEvent, string]> = [['ctrlKey', 'ctrl'], ['altKey', 'alt'], ['shiftKey', 'shift'], ['metaKey', 'win']];

/** Browser `KeyboardEvent.key` names that pyautogui names differently. */
const KEY_NAMES: Readonly<Record<string, string>> = {
  ' ': 'space', Enter: 'enter', Escape: 'esc', Backspace: 'backspace', Tab: 'tab', Delete: 'delete', Insert: 'insert',
  Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  CapsLock: 'capslock', PrintScreen: 'printscreen', ContextMenu: 'apps',
};

const MODIFIER_ONLY = new Set(['Control', 'Alt', 'Shift', 'Meta', 'OS', 'AltGraph']);

/** The pyautogui name of a non-modifier key, or null when it has none (dead keys, Unidentified). */
function keyName(key: string): string | null {
  if (KEY_NAMES[key]) return KEY_NAMES[key];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key.toLowerCase();
  return key.length === 1 ? key.toLowerCase() : null;
}

/**
 * A keyboard event as the pyautogui combo a key step replays ("ctrl+shift+s", "enter").
 * Null while only modifiers are held, or for a key pyautogui cannot press.
 */
export function keyCombo(e: HotkeyEvent): string | null {
  if (MODIFIER_ONLY.has(e.key)) return null;
  const key = keyName(e.key);
  if (!key) return null;
  const mods = MODIFIERS.filter(([flag]) => e[flag]).map(([, name]) => name);
  return [...mods, key].join('+');
}

/** A recorded key press as a key step; the recorder stamps its measured pause (`delayMs`) when appending it. */
export function keyStep(id: string, combo: string): WorkflowStep {
  return { id, name: `Press ${combo}`, action: 'key', x: 0.5, y: 0.5, text: combo, status: 'pending' };
}

/** The scroll direction of a wheel delta: a negative deltaY scrolls up. */
export const scrollDirection = (deltaY: number): 'up' | 'down' => (deltaY < 0 ? 'up' : 'down');

/** A recorded wheel gesture at (x, y) as a scroll step; the recorder stamps its measured pause when appending it. */
export function scrollStep(id: string, x: number, y: number, deltaY: number): WorkflowStep {
  const dir = scrollDirection(deltaY);
  return { id, name: `Scroll ${dir}`, action: 'scroll', x, y, text: dir, status: 'pending' };
}

/** True when a wheel event continues `last`'s scroll gesture (same direction, within SCROLL_MERGE_MS) instead of starting a step. */
export function continuesScroll(last: WorkflowStep | undefined, deltaY: number, sinceLastMs: number): boolean {
  return last?.action === 'scroll' && last.text === scrollDirection(deltaY) && sinceLastMs < SCROLL_MERGE_MS;
}
