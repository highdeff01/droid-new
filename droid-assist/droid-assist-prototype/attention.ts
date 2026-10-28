/**
 * Attention management: popup context is quarantined to the popup watcher's own scope, and the
 * AI's current focus is tracked explicitly for the Current operation panel.
 */
import type { StageId } from './loop-control.js';

/** True when a context line is about a popup (the popup watcher's findings, popup decisions, popup-kind changes). */
export const isPopupLine = (text: string) => /\bpop-?ups?\b/i.test(text);

/** True when a log entry belongs to the popup scope, by its source or its message. */
export const isPopupEntry = (entry: { source: string; message: string }) => isPopupLine(`${entry.source} ${entry.message}`);

/** The context lines a call of `stage` may see: popup lines only reach the popup watcher's own calls. */
export const scopeLines = (lines: string[], stage: StageId): string[] => (stage === 'popup' ? lines : lines.filter((l) => !isPopupLine(l)));

/** What the AI is focused on right now, who put it there and since when. */
export interface Attention {
  focus: string;
  source: string;
  since: number;
}

/** No focus yet. */
export const IDLE_ATTENTION: Attention = { focus: 'Idle — no AI decision in progress', source: 'AI', since: 0 };

/** Moves the focus to `focus`; the same focus from the same source keeps its original since-time. */
export const focusOn = (prev: Attention, focus: string, source: string, now = Date.now()): Attention =>
  prev.focus === focus && prev.source === source ? prev : { focus, source, since: now };
