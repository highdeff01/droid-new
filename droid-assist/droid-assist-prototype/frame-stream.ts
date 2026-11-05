/**
 * Bandwidth-aware frame streaming: when several consumers pull frames at once, the stream adapts
 * its quality and rate to the bandwidth they can take, and verification frames (the ones a check
 * depends on) are prioritised over monitoring ones. The plan is pure so it is testable and the
 * caller only has to apply it.
 */

/** What a frame is for: a check depends on it, or it is just being watched. */
export type FrameUse = 'verification' | 'monitoring';

/** One consumer of the stream. */
export interface FrameConsumer {
  id: string;
  /** Bytes per second it can take; 0 means it is not currently pulling. */
  budgetBytes: number;
  /** The use of the frames it wants. */
  use: FrameUse;
}

/** The chosen quality and rate for the next frame. */
export interface StreamPlan {
  /** JPEG quality, 1..100. */
  quality: number;
  /** Milliseconds between frames. */
  intervalMs: number;
  /** Total consumers pulling. */
  consumers: number;
  /** How many of them want verification frames. */
  verification: number;
  /** One line explaining the choice. */
  reason: string;
}

/** The quality range frames may be sent at. */
export const QUALITY_MIN = 30;
export const QUALITY_MAX = 95;
/** The interval range (fastest..slowest). */
export const INTERVAL_MIN_MS = 250;
export const INTERVAL_MAX_MS = 2000;
/** Roughly the bytes one frame takes at quality 100 (used to fit a budget). */
export const FRAME_BYTES_AT_MAX = 250_000;
/** Below this total budget the stream is considered constrained. */
export const CONSTRAINED_BYTES = 400_000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Bytes one frame costs at `quality`. */
export const frameBytes = (quality: number) => Math.round((FRAME_BYTES_AT_MAX * quality) / QUALITY_MAX);

/**
 * Plans the next frame for `consumers`. The slowest requirement wins on rate (a verification
 * consumer must be served fast enough to check a step); quality is raised for verification and
 * lowered when the combined budget is tight, so multiple consumers degrade gracefully instead of
 * starving. With no consumers the stream idles at the slowest rate.
 */
export function planStream(consumers: readonly FrameConsumer[]): StreamPlan {
  const pulling = consumers.filter((c) => c.budgetBytes > 0);
  const verification = pulling.filter((c) => c.use === 'verification').length;
  if (!pulling.length) return { quality: QUALITY_MIN, intervalMs: INTERVAL_MAX_MS, consumers: 0, verification: 0, reason: 'no consumers — idling at the slowest rate' };

  const totalBudget = pulling.reduce((sum, c) => sum + c.budgetBytes, 0);
  // The rate is set by the fastest need: a verification consumer wants a frame every INTERVAL_MIN_MS.
  const intervalMs = verification ? INTERVAL_MIN_MS : clamp(Math.round(INTERVAL_MAX_MS / pulling.length), INTERVAL_MIN_MS, INTERVAL_MAX_MS);
  const perFrame = totalBudget * (intervalMs / 1000);
  const quality = clamp(Math.round((perFrame / FRAME_BYTES_AT_MAX) * QUALITY_MAX), QUALITY_MIN, QUALITY_MAX);
  const constrained = totalBudget < CONSTRAINED_BYTES;
  const reason = verification
    ? `${verification} verification consumer(s) of ${pulling.length} — ${intervalMs}ms, quality ${quality}${constrained ? ' (budget tight)' : ''}`
    : `${pulling.length} monitoring consumer(s) — ${intervalMs}ms, quality ${quality}${constrained ? ' (budget tight)' : ''}`;
  return { quality, intervalMs, consumers: pulling.length, verification, reason };
}

/**
 * Priority order of frames to send this tick: verification first, then monitoring, oldest request
 * first within each class, so a step's check is never starved by a watcher.
 */
export function frameOrder(requests: readonly { consumer: string; use: FrameUse; at: number }[]): { consumer: string; use: FrameUse; at: number }[] {
  return [...requests].sort((a, b) => Number(b.use === 'verification') - Number(a.use === 'verification') || a.at - b.at);
}

/** One line for the log. */
export const streamLine = (p: StreamPlan) => `Frame stream: ${p.intervalMs}ms, quality ${p.quality} — ${p.reason}`;

/** Whether a plan has changed enough from the last one to be worth applying. */
export const planChanged = (a: StreamPlan | null, b: StreamPlan): boolean => !a || a.quality !== b.quality || a.intervalMs !== b.intervalMs;
