import type { AiStatus } from './ai.js';

/** Wait before calling the endpoint again after the 1st, 2nd, … repeat-limit 500 in a row; the last one is the cap. */
export const REPEAT_LIMIT_BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 300_000] as const;

/** Repeat-limit failures: how many in a row (reset by a good reply), how many in total, and when calls may resume. */
export interface AiBackoff {
  streak: number;
  total: number;
  /** Epoch ms before which no call is sent; 0 = not backing off. */
  until: number;
}

export const NO_BACKOFF: AiBackoff = { streak: 0, total: 0, until: 0 };

/** The wait after the `streak`-th repeat-limit failure in a row (1-based), capped at the last delay. */
export const backoffDelay = (streak: number) => REPEAT_LIMIT_BACKOFF_MS[Math.min(Math.max(streak, 1), REPEAT_LIMIT_BACKOFF_MS.length) - 1];

/** One more repeat-limit failure at `now`: the streak and total grow and calls wait backoffDelay(streak). */
export function noteRepeatLimit(b: AiBackoff, now: number): AiBackoff {
  const streak = b.streak + 1;
  return { streak, total: b.total + 1, until: now + backoffDelay(streak) };
}

/** A good reply: the streak and the wait end; the total is kept for the log. */
export const clearBackoff = (b: AiBackoff): AiBackoff => ({ ...b, streak: 0, until: 0 });

/** Whole seconds left before calls resume; 0 when not backing off. */
export const backoffLeftSec = (b: AiBackoff, now: number) => Math.max(0, Math.ceil((b.until - now) / 1000));

/** The plain status line while waiting, e.g. "endpoint erroring — retrying in 15s". */
export const backoffText = (b: AiBackoff, now: number) => `endpoint erroring — retrying in ${backoffLeftSec(b, now)}s`;

/** The AI status badge while backing off. */
export const backoffStatus = (b: AiBackoff, now: number): AiStatus => ({
  state: 'backoff',
  detail: `${backoffText(b, now)} (repeat-limit 500 ×${b.streak} in a row, ${b.total} total)`,
});

/** The log line counting one repeat-limit failure distinctly. */
export const repeatLimitLine = (b: AiBackoff, now: number) =>
  `Repeat-limit 500 #${b.total} (model looped on repeated tokens; ${b.streak} in a row) — the rephrased retry failed too; ${backoffText(b, now)}`;
