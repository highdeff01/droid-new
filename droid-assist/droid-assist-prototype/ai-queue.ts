import { AiCancelled, DEFAULT_AI_TIMEOUT_MS } from './ai.js';
import { stageOf, type StageId } from './loop-control.js';

/**
 * The shared model-call queue: every AI call waits here until one of `maxInFlight` slots is free.
 * Lower tiers dispatch first; within a tier calls dispatch in arrival order (FIFO).
 */

/** 0 = executor/grounding, 1 = planner/verdict and the rest of the pipeline, 2 = background agents. */
export type AiPriority = 0 | 1 | 2;

/** Default cap on model calls in flight at once. */
export const DEFAULT_AI_MAX_IN_FLIGHT = 2;
/** Settings range of the in-flight cap. */
export const AI_MAX_IN_FLIGHT_MIN = 1;
export const AI_MAX_IN_FLIGHT_MAX = 8;

/** Stages that act on the screen right now: dispatched before anything else. */
const FIRST_TIER: ReadonlySet<StageId> = new Set<StageId>(['executor', 'grounding']);

/** The tier of a loop-control stage: executor/grounding first, other pipeline stages next, agents last. */
export function stagePriority(stage: StageId): AiPriority {
  if (FIRST_TIER.has(stage)) return 0;
  return stageOf(stage).group === 'pipeline' ? 1 : 2;
}

/** Queue depth and calls running, for the HUD. */
export interface AiQueueStats {
  queued: number;
  inFlight: number;
}

interface Waiting {
  stage: StageId;
  priority: AiPriority;
  seq: number;
  start: () => void;
  cancel: (error: AiCancelled) => void;
}

/** The text a queued call is rejected with when its stage is drained. */
export const drainedText = (stage: StageId) => `${stageOf(stage).name} was disabled — its queued AI call was dropped`;

/**
 * A priority queue in front of the model endpoint. `run` starts `task` once a slot is free and
 * settles with it; `task` gets the per-call timeout current at that moment (`timeoutMs`, changed
 * by `setTimeoutMs`), so time spent waiting never counts against it. A call whose `signal` aborts
 * while it waits is dropped (rejects AiCancelled, `task` never runs). `drain(stage)` drops every
 * waiting call of that stage. `onChange` fires on every change of the stats.
 */
export function createAiQueue(maxInFlight: number, onChange: (stats: AiQueueStats) => void = () => undefined, timeoutMs = DEFAULT_AI_TIMEOUT_MS) {
  let limit = maxInFlight;
  let timeout = timeoutMs;
  let inFlight = 0;
  let seq = 0;
  let waiting: Waiting[] = [];
  const stats = (): AiQueueStats => ({ queued: waiting.length, inFlight });
  const changed = () => onChange(stats());

  const next = (): Waiting | undefined => {
    const best = waiting.reduce<Waiting | undefined>((a, w) => (!a || w.priority < a.priority || (w.priority === a.priority && w.seq < a.seq) ? w : a), undefined);
    if (best) waiting = waiting.filter((w) => w !== best);
    return best;
  };

  const pump = () => {
    let started = false;
    for (let w = inFlight < limit ? next() : undefined; w; w = inFlight < limit ? next() : undefined) {
      inFlight++;
      started = true;
      w.start();
    }
    if (started) changed();
  };

  const remove = (drop: (w: Waiting) => boolean, error: (w: Waiting) => AiCancelled) => {
    const dropped = waiting.filter(drop);
    if (!dropped.length) return 0;
    waiting = waiting.filter((w) => !drop(w));
    for (const w of dropped) w.cancel(error(w));
    changed();
    return dropped.length;
  };

  const run = <T>(stage: StageId, task: (timeoutMs: number) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) return Promise.reject(new AiCancelled('AI request cancelled while queued'));
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => remove((w) => w === entry, () => new AiCancelled('AI request cancelled while queued'));
      const entry: Waiting = {
        stage,
        priority: stagePriority(stage),
        seq: seq++,
        start: () => {
          signal?.removeEventListener('abort', onAbort);
          task(timeout).then(resolve, reject).finally(() => {
            inFlight--;
            changed();
            pump();
          });
        },
        cancel: (error) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      waiting.push(entry);
      changed();
      pump();
    });
  };

  return {
    run,
    /** Drops every waiting call of `stage` (rejecting AiCancelled); returns how many were dropped. */
    drain: (stage: StageId) => remove((w) => w.stage === stage, (w) => new AiCancelled(drainedText(w.stage))),
    /** Changes the in-flight cap; a raised cap starts waiting calls at once. */
    setLimit: (n: number) => {
      limit = n;
      pump();
    },
    /** Changes the per-call timeout handed to calls dispatched from now on. */
    setTimeoutMs: (ms: number) => {
      timeout = ms;
    },
    stats,
  };
}

/** The queue's public surface. */
export type AiQueue = ReturnType<typeof createAiQueue>;
