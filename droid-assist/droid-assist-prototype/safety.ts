/** Default emergency-stop combo. Ctrl+Shift+Esc is avoided: Windows reserves it for Task Manager. */
export const DEFAULT_ABORT_HOTKEY = 'Shift+Escape';

/** Default cap on real (bridge-dispatched) input actions per Auto Act / replay run. */
export const DEFAULT_ACTION_BUDGET = 50;

/** The parts of a keyboard event a hotkey is made of. */
export interface HotkeyEvent {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

/**
 * Canonical combo string for a key event, e.g. "Ctrl+Shift+Escape".
 * Returns '' while only modifiers are held (no combo yet).
 */
export function hotkeyFromEvent(e: HotkeyEvent): string {
  if (MODIFIER_KEYS.has(e.key)) return '';
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
  return [...mods, key].join('+');
}

/** True when the event is exactly the configured combo (case-insensitive). */
export function matchesHotkey(e: HotkeyEvent, hotkey: string): boolean {
  const combo = hotkeyFromEvent(e);
  return combo !== '' && combo.toLowerCase() === hotkey.trim().toLowerCase();
}

/** Coerces a user-entered budget to a whole number ≥ 1; empty/NaN means the default, never unlimited. */
export function sanitizeBudget(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ACTION_BUDGET;
  return Math.max(1, Math.floor(value));
}

/** Real input actions spent so far in one run, against its limit. */
export interface ActionBudget {
  used: number;
  limit: number;
}

/** A fresh, unspent budget for a new run. */
export function createBudget(limit: number): ActionBudget {
  return { used: 0, limit: sanitizeBudget(limit) };
}

/** Spends one action if any remain; false means the run has hit its budget and must stop. */
export function spendAction(budget: ActionBudget): boolean {
  if (budget.used >= budget.limit) return false;
  budget.used += 1;
  return true;
}
