/** One persisted conversation turn: its text only (never images or thinking) and when it was recorded. */
export interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  /** Epoch ms the turn was recorded; absent on history persisted before timestamps existed. */
  time?: number;
}

/** Default number of newest messages sent to the model with every ask (the read window). */
export const HISTORY_WINDOW_DEFAULT = 50;
/** Largest read window Settings allows. */
export const HISTORY_WINDOW_MAX = 100;
/** Every time the archive grows past a multiple of this many messages, all data is auto-saved. */
export const AUTO_SAVE_EVERY = 100;
/** Consecutive unparseable replies that mark the context as stale. */
export const STALE_PARSE_LIMIT = 2;
/** Messages a stale-context trim keeps. */
export const STALE_KEEP = 4;

/** Why the history shrank: a user trim, the stale-context guard, or a full reset. */
export type TrimReason = 'manual' | 'stale' | 'reset';

/** One trim or reset: the message counts before and after it. */
export interface HistoryChange {
  reason: TrimReason;
  before: number;
  after: number;
}

/** A rough token count for `text` (about four characters per token). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/** Size of a history: messages, characters and estimated tokens. */
export function historyStats(entries: HistoryEntry[]): { messages: number; chars: number; tokens: number } {
  const chars = entries.reduce((n, e) => n + e.content.length, 0);
  const tokens = entries.reduce((n, e) => n + estimateTokens(e.content), 0);
  return { messages: entries.length, chars, tokens };
}

/** The newest `keep` entries (all of them when there are fewer; none when keep <= 0). */
export function trimHistory(entries: HistoryEntry[], keep: number): HistoryEntry[] {
  return entries.slice(Math.max(0, entries.length - Math.max(0, Math.floor(keep))));
}

/** True when growing from `before` to `after` messages crosses a multiple of AUTO_SAVE_EVERY. */
export const autoSaveDue = (before: number, after: number) => Math.floor(after / AUTO_SAVE_EVERY) > Math.floor(before / AUTO_SAVE_EVERY);

const CHANGE_TEXT: Record<TrimReason, (c: HistoryChange) => string> = {
  manual: (c) => `Trimmed AI conversation history to the last ${c.after} message(s) (was ${c.before})`,
  stale: (c) => `Stale context: ${STALE_PARSE_LIMIT} unparseable replies in a row — trimmed AI history ${c.before} → ${c.after} message(s)`,
  reset: (c) => `AI session reset — cleared ${c.before} history message(s)`,
};

/** The activity-log line of a trim or reset. */
export const historyChangeText = (change: HistoryChange) => CHANGE_TEXT[change.reason](change);
