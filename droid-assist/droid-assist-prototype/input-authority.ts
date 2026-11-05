/**
 * The single serialization and ownership boundary for physical mouse/keyboard input.
 *
 * Planning, screenshot analysis and other passive work should stay outside this queue.
 * Adapters must call lease.assertCurrent() immediately before EVERY OS input event;
 * AbortSignal is cooperative and cannot interrupt an OS call already in progress.
 */
export type InputOwner = 'user' | 'droid-new' | 'droid-main' | 'system';

export interface InputLease {
  readonly owner: InputOwner;
  readonly generation: number;
  readonly signal: AbortSignal;
  /** Throws when ownership changed, the user paused input, or this lease was aborted. */
  assertCurrent(): void;
}

export interface InputAuthoritySnapshot {
  owner: InputOwner;
  generation: number;
  paused: boolean;
  queued: number;
  active: boolean;
}

export interface TakeoverEvidence {
  /** The current controller has explicitly reported that the goal is complete. */
  goalReached?: boolean;
  /** Number of steps verified as successful by post-action evidence. */
  verifiedProgressCount: number;
  /** Timestamp of the most recent verified step; null when none has been verified. */
  lastVerifiedAt: number | null;
  /** When the current controller began this attempt. */
  startedAt: number;
  /** Evaluation time, injectable so policy is deterministic and testable. */
  now: number;
  /** How long without verified progress is considered a stall. */
  stallThresholdMs?: number;
  /** A monitor has concrete evidence that the current controller failed or became unresponsive. */
  currentControllerFailed?: boolean;
  /** Explicit user decision takes precedence over agent evidence. */
  userDecision?: 'approve' | 'reject';
}

export interface TakeoverDecision {
  accepted: boolean;
  reason: string;
  previousOwner: InputOwner;
  requestedOwner: InputOwner;
  generation: number;
}

export class InputLeaseError extends Error {
  override name = 'InputLeaseError';
  constructor(message = 'Physical input lease is no longer current') {
    super(message);
  }
}

interface QueueItem<T> {
  owner: InputOwner;
  generation: number;
  task: (lease: InputLease) => Promise<T> | T;
  resolve(value: T): void;
  reject(reason: unknown): void;
  controller: AbortController;
}

/**
 * FIFO gate for all physical input. Ownership changes fence off delayed work from
 * previous controllers. A paused gate accepts no new work until explicitly resumed.
 */
export function createInputAuthority(initialOwner: InputOwner = 'droid-new') {
  let owner = initialOwner;
  let generation = 0;
  let paused = false;
  let active: QueueItem<unknown> | null = null;
  const queue: QueueItem<unknown>[] = [];
  let draining = false;

  const leaseFor = (item: QueueItem<unknown>): InputLease => ({
    owner: item.owner,
    generation: item.generation,
    signal: item.controller.signal,
    assertCurrent: () => {
      if (item.controller.signal.aborted || paused || item.generation !== generation || item.owner !== owner) {
        throw new InputLeaseError();
      }
    },
  });

  const rejectStaleQueued = () => {
    for (let i = queue.length - 1; i >= 0; i--) {
      const item = queue[i];
      if (item.generation !== generation || item.owner !== owner || paused) {
        queue.splice(i, 1);
        item.controller.abort();
        item.reject(new InputLeaseError(paused ? 'Physical input is paused' : 'Input ownership changed before execution'));
      }
    }
  };

  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      while (queue.length) {
        const item = queue.shift()!;
        if (item.generation !== generation || item.owner !== owner || paused) {
          item.reject(new InputLeaseError());
          continue;
        }
        active = item;
        const lease = leaseFor(item);
        try {
          lease.assertCurrent();
          const result = await item.task(lease);
          lease.assertCurrent();
          item.resolve(result);
        } catch (error) {
          item.reject(error);
        } finally {
          active = null;
        }
      }
    } finally {
      draining = false;
      // A task can enqueue at the edge of the drain's finalization.
      if (queue.length) void drain();
    }
  };

  const run = <T>(requestedOwner: InputOwner, task: (lease: InputLease) => Promise<T> | T): Promise<T> => {
    if (paused) return Promise.reject(new InputLeaseError('Physical input is paused by the user'));
    if (requestedOwner !== owner) return Promise.reject(new InputLeaseError(`Input owner is ${owner}, not ${requestedOwner}`));
    const item: QueueItem<T> = {
      owner: requestedOwner,
      generation,
      task,
      controller: new AbortController(),
      resolve: () => undefined,
      reject: () => undefined,
    };
    const promise = new Promise<T>((resolve, reject) => {
      item.resolve = resolve;
      item.reject = reject;
    });
    queue.push(item as QueueItem<unknown>);
    void drain();
    return promise;
  };

  const invalidate = (reason = 'Physical input authority invalidated') => {
    generation++;
    if (active) active.controller.abort(new InputLeaseError(reason));
    for (const item of queue.splice(0)) {
      item.controller.abort(new InputLeaseError(reason));
      item.reject(new InputLeaseError(reason));
    }
    return generation;
  };

  const changeOwner = (nextOwner: InputOwner, reason = 'Physical input controller changed') => {
    if (nextOwner === owner) return generation;
    const nextGeneration = invalidate(reason);
    owner = nextOwner;
    return nextGeneration;
  };

  const setPaused = (value: boolean) => {
    if (paused === value) return generation;
    paused = value;
    return invalidate(value ? 'User paused physical input' : 'Physical input resumed with a fresh lease');
  };

  /**
   * Evidence-based cooperative takeover. A requester never steals control merely by asking:
   * user rejection and a completed goal always win; otherwise require user approval, a failed
   * controller, or a verified-progress stall. A successful transfer fences every old lease.
   */
  const requestTakeover = (nextOwner: InputOwner, evidence: TakeoverEvidence): TakeoverDecision => {
    const previousOwner = owner;
    const threshold = Math.max(1_000, evidence.stallThresholdMs ?? 15_000);
    const lastProgress = evidence.lastVerifiedAt ?? evidence.startedAt;
    const elapsed = Math.max(0, evidence.now - lastProgress);
    const stalled = elapsed >= threshold;

    let accepted = false;
    let reason = 'Takeover rejected: current controller has not been shown to be stalled or failed';
    if (nextOwner === owner) {
      reason = 'Takeover not needed: requester already owns physical input';
    } else if (paused) {
      reason = 'Takeover rejected: physical input is paused by the user';
    } else if (owner === 'user') {
      reason = 'Takeover rejected: the user currently owns physical input; automation must wait for an explicit return-control action';
    } else if (evidence.userDecision === 'reject') {
      reason = 'Takeover rejected by the user';
    } else if (evidence.goalReached) {
      reason = 'Takeover rejected: current controller has verified the goal is complete';
    } else if (evidence.userDecision === 'approve') {
      accepted = true;
      reason = 'Takeover accepted by explicit user approval';
    } else if (evidence.currentControllerFailed) {
      accepted = true;
      reason = 'Takeover accepted: current controller failure was reported';
    } else if (stalled) {
      accepted = true;
      reason = `Takeover accepted: no verified progress for ${elapsed}ms (stall threshold ${threshold}ms)`;
    } else if (evidence.verifiedProgressCount > 0) {
      reason = `Takeover rejected: current controller has recent verified progress (${elapsed}ms since last success)`;
    } else {
      reason = `Takeover rejected: controller has not yet exceeded the ${threshold}ms no-progress window`;
    }

    if (accepted) changeOwner(nextOwner, reason);
    return { accepted, reason, previousOwner, requestedOwner: nextOwner, generation };
  };

  return {
    run,
    changeOwner,
    setPaused,
    requestTakeover,
    invalidate,
    snapshot: (): InputAuthoritySnapshot => ({
      owner,
      generation,
      paused,
      queued: queue.length,
      active: active !== null,
    }),
  };
}
