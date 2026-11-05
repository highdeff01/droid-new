import type { AskRequest } from './ai.js';
import type { Frame } from './types.js';
import { decisionSystem } from './wake-decision.js';

/** Default wake timer: the AI is woken 30 s into a wait. */
export const DEFAULT_WAKE_MS = 30000;
/** Valid range of the user's wake timer (matches its Settings slider). */
export const WAKE_MS_MIN = 5000;
export const WAKE_MS_MAX = 600000;

/** Bounds of the backup watcher's screenshot interval. */
const WATCH_MIN_MS = 1000;

/**
 * How long a wait lasts before the AI is woken: the user's timer, or the AI's own estimate when
 * that is longer (the AI never shortens the wait). A missing or invalid AI time uses the user's.
 */
export function wakeDelay(userMs: number, aiMs?: number): number {
  const ai = typeof aiMs === 'number' && Number.isFinite(aiMs) && aiMs > 0 ? Math.min(aiMs, WAKE_MS_MAX) : 0;
  return Math.max(userMs, ai);
}

/** The backup watcher's screenshot interval: a quarter of the wait, at least 1 s and at most half of it. */
export const watchInterval = (delay: number) => Math.min(delay / 2, Math.max(WATCH_MIN_MS, delay / 4));

/** Why a wait ended: its timer ran out, the backup watcher saw a notable change, or the watcher hit an error. */
export type WakeCause = 'timer' | 'change' | 'error';

/** A wake: its cause and what the watcher saw (empty for the timer). */
export interface WakeEvent {
  cause: WakeCause;
  detail: string;
}

/** What one backup-watched wait needs. */
export interface WakeOptions {
  delay: number;
  interval: number;
  /** One backup-watcher look: a notable change's description, or null; a throw is an error wake. */
  check: () => Promise<string | null>;
  onWake: (e: WakeEvent) => void;
}

/** A running wait: cancelling it fires nothing. */
export interface WakeSession {
  cancel: () => void;
  readonly done: boolean;
}

/**
 * Starts a wait that wakes exactly once — when the timer runs out, or earlier when the backup
 * watcher reports a notable change or an error. A wake or a cancel stops both the timer and the watcher.
 */
export function createWakeSession({ delay, interval, check, onWake }: WakeOptions): WakeSession {
  let done = false;
  let looking = false;
  const end = () => {
    done = true;
    clearTimeout(timer);
    clearInterval(watch);
  };
  const fire = (e: WakeEvent) => {
    if (done) return;
    end();
    onWake(e);
  };
  const look = async () => {
    if (done || looking) return;
    looking = true;
    try {
      const change = await check();
      if (change) fire({ cause: 'change', detail: change });
    } catch (error) {
      fire({ cause: 'error', detail: error instanceof Error ? error.message : String(error) });
    } finally {
      looking = false;
    }
  };
  const timer = setTimeout(() => fire({ cause: 'timer', detail: '' }), delay);
  const watch = setInterval(() => void look(), interval);
  return { cancel: end, get done() { return done; } };
}

/** What the AI was doing when it started waiting, kept to remind it on wake. */
export interface WaitContext {
  goal: string;
  /** The step it was about to run. */
  step: string;
  /** What it is waiting on, in its own words. */
  waitingOn: string;
  since: number;
  delay: number;
  /** Screenshots from before the wait, newest first. */
  before: Frame[];
  /** Log / notes lines from before the wait. */
  beforeInfo: string[];
}

/** What a wake brings: fresh screenshots (newest first) and fresh log / notes lines. */
export interface WakeCapture {
  fresh: Frame[];
  freshInfo: string[];
}

const CAUSE_TEXT: Record<WakeCause, (e: WakeEvent) => string> = {
  timer: () => 'Your wait timer ran out.',
  change: (e) => `The backup watcher woke you early: the screen changed notably (${e.detail}).`,
  error: (e) => `The backup watcher woke you early on an error: ${e.detail}.`,
};

/**
 * The wake request: the fresh screenshot first, then the earlier screenshots from before the wait,
 * the info from before and after the wait as context, and a reminder of what the AI was waiting on.
 */
export function wakeRequest(ctx: WaitContext, cap: WakeCapture, e: WakeEvent): AskRequest {
  const [frame = null, ...moreFresh] = cap.fresh;
  const waited = Math.round((Date.now() - ctx.since) / 1000);
  const prompt = [
    `Goal: ${ctx.goal || '(none)'}`,
    `You paused before step "${ctx.step}" ${waited} s ago, waiting on: ${ctx.waitingOn}`,
    CAUSE_TEXT[e.cause](e),
    `Images: the first ${1 + moreFresh.length} ${moreFresh.length ? 'are' : 'is'} the FRESH screen (newest first); the next ${ctx.before.length} are from BEFORE the wait (newest first).`,
    'Continue the current operation: factor in what changed between before and now, then decide.',
  ].join('\n');
  const context = [...ctx.beforeInfo.map((l) => `[before wait] ${l}`), ...cap.freshInfo.map((l) => `[after wait] ${l}`)];
  return { system: decisionSystem, prompt, frame, frames: [...moreFresh, ...ctx.before], context, json: true };
}
