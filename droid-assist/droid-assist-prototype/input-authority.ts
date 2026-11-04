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

  return {
    run,
    changeOwner,
    setPaused,
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
