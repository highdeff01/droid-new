import { describe, expect, it } from 'vitest';
import { createInputAuthority, InputLeaseError } from './input-authority.js';

describe('physical input authority', () => {
  it('serializes queued work in order', async () => {
    const a = createInputAuthority();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const first = a.run('droid-new', async () => { order.push('start'); await gate; order.push('end'); });
    const second = a.run('droid-new', () => { order.push('next'); });
    expect(order).toEqual(['start']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['start', 'end', 'next']);
  });
  it('fences old queued work on takeover', async () => {
    const a = createInputAuthority();
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const active = a.run('droid-new', () => gate);
    const queued = a.run('droid-new', () => 'stale');
    a.changeOwner('droid-main');
    await expect(queued).rejects.toBeInstanceOf(InputLeaseError);
    release();
    await expect(active).rejects.toBeInstanceOf(InputLeaseError);
    await expect(a.run('droid-main', () => 'current')).resolves.toBe('current');
  });
  it('aborts the active lease and rejects stale event guards', async () => {
    const a = createInputAuthority();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const ready = new Promise<void>(r => { started = r; });
    let signal!: AbortSignal;
    let guardError: unknown;
    const active = a.run('droid-new', async lease => { signal = lease.signal; started(); await gate; try { lease.assertCurrent(); } catch (e) { guardError = e; throw e; } });
    await ready;
    a.changeOwner('droid-main');
    expect(signal.aborted).toBe(true);
    release();
    await expect(active).rejects.toBeInstanceOf(InputLeaseError);
    expect(guardError).toBeInstanceOf(InputLeaseError);
  });
  it('pauses and resumes under user control', async () => {
    const a = createInputAuthority();
    a.setPaused(true);
    await expect(a.run('droid-new', () => 1)).rejects.toBeInstanceOf(InputLeaseError);
    a.setPaused(false);
    await expect(a.run('droid-new', () => 2)).resolves.toBe(2);
  });
  it('rejects requests from the non-owner', async () => {
    const a = createInputAuthority();
    await expect(a.run('droid-main', () => 1)).rejects.toBeInstanceOf(InputLeaseError);
  });
  it('fences an active lease immediately when the user pauses input', async () => {
    const a = createInputAuthority();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { started = resolve; });
    let leaseSignal!: AbortSignal;
    let guarded = false;
    const active = a.run('droid-new', async lease => {
      leaseSignal = lease.signal;
      started();
      await gate;
      expect(() => lease.assertCurrent()).toThrow(InputLeaseError);
      guarded = true;
    });
    await ready;
    a.setPaused(true);
    expect(leaseSignal.aborted).toBe(true);
    release();
    await expect(active).rejects.toBeInstanceOf(InputLeaseError);
    expect(guarded).toBe(true);
    expect(a.snapshot().paused).toBe(true);
  });

  it('continues draining after a task fails', async () => {
    const a = createInputAuthority();
    const first = a.run('droid-new', () => { throw new Error('adapter failed'); });
    const second = a.run('droid-new', () => 'next task ran');
    await expect(first).rejects.toThrow('adapter failed');
    await expect(second).resolves.toBe('next task ran');
    expect(a.snapshot()).toMatchObject({ active: false, queued: 0 });
  });

  it('invalidates queued work even when ownership remains unchanged', async () => {
    const a = createInputAuthority();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const active = a.run('droid-new', () => gate);
    const queued = a.run('droid-new', () => 'must not run');
    const previousGeneration = a.snapshot().generation;
    a.invalidate('workflow cancelled');
    expect(a.snapshot().generation).toBe(previousGeneration + 1);
    await expect(queued).rejects.toBeInstanceOf(InputLeaseError);
    release();
    await expect(active).rejects.toBeInstanceOf(InputLeaseError);
    await expect(a.run('droid-new', () => 'fresh lease')).resolves.toBe('fresh lease');
  });

  it('rejects takeover while the current controller is making verified progress', () => {
    const a = createInputAuthority();
    const decision = a.requestTakeover('droid-main', {
      verifiedProgressCount: 4,
      lastVerifiedAt: 9_500,
      startedAt: 1_000,
      now: 10_000,
      stallThresholdMs: 5_000,
    });
    expect(decision).toMatchObject({ accepted: false, previousOwner: 'droid-new', requestedOwner: 'droid-main', generation: 0 });
    expect(decision.reason).toContain('recent verified progress');
    expect(a.snapshot().owner).toBe('droid-new');
  });

  it('accepts takeover when verified progress has stalled and invalidates the old generation', async () => {
    const a = createInputAuthority();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { started = resolve; });
    const active = a.run('droid-new', async lease => { started(); await gate; lease.assertCurrent(); });
    await ready;
    const decision = a.requestTakeover('droid-main', {
      verifiedProgressCount: 2,
      lastVerifiedAt: 1_000,
      startedAt: 500,
      now: 20_000,
      stallThresholdMs: 10_000,
    });
    expect(decision.accepted).toBe(true);
    expect(decision.reason).toContain('no verified progress');
    expect(a.snapshot()).toMatchObject({ owner: 'droid-main', generation: 1 });
    release();
    await expect(active).rejects.toBeInstanceOf(InputLeaseError);
    await expect(a.run('droid-main', () => 'new owner')).resolves.toBe('new owner');
  });

  it('lets explicit user approval authorize takeover before the stall threshold', () => {
    const a = createInputAuthority();
    const decision = a.requestTakeover('droid-main', {
      verifiedProgressCount: 3,
      lastVerifiedAt: 9_900,
      startedAt: 1_000,
      now: 10_000,
      userDecision: 'approve',
    });
    expect(decision.accepted).toBe(true);
    expect(decision.reason).toContain('explicit user approval');
    expect(a.snapshot().owner).toBe('droid-main');
  });

  it('honors user rejection even when a controller is reported failed', () => {
    const a = createInputAuthority();
    const decision = a.requestTakeover('droid-main', {
      verifiedProgressCount: 0,
      lastVerifiedAt: null,
      startedAt: 0,
      now: 60_000,
      currentControllerFailed: true,
      userDecision: 'reject',
    });
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toContain('rejected by the user');
    expect(a.snapshot().owner).toBe('droid-new');
  });

  it('does not transfer control after the goal is verified complete', () => {
    const a = createInputAuthority();
    const decision = a.requestTakeover('droid-main', {
      goalReached: true,
      verifiedProgressCount: 10,
      lastVerifiedAt: 9_000,
      startedAt: 0,
      now: 100_000,
      currentControllerFailed: true,
      userDecision: 'approve',
    });
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toContain('goal is complete');
    expect(a.snapshot().owner).toBe('droid-new');
  });

  it('does not permit agent takeover while the user has paused physical input', () => {
    const a = createInputAuthority();
    a.setPaused(true);
    const decision = a.requestTakeover('droid-main', {
      verifiedProgressCount: 0,
      lastVerifiedAt: null,
      startedAt: 0,
      now: 60_000,
      userDecision: 'approve',
    });
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toContain('paused by the user');
    expect(a.snapshot()).toMatchObject({ owner: 'droid-new', paused: true });
  });

  it('supports exclusive user ownership and explicit return to automation', async () => {
    const a = createInputAuthority();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { started = resolve; });
    const active = a.run('droid-new', async lease => { started(); await gate; lease.assertCurrent(); });
    await ready;
    a.changeOwner('user', 'user took control');
    expect(a.snapshot().owner).toBe('user');
    await expect(a.run('droid-new', () => 'stale')).rejects.toBeInstanceOf(InputLeaseError);
    release();
    await expect(active).rejects.toBeInstanceOf(InputLeaseError);
    a.changeOwner('droid-main', 'user returned control');
    await expect(a.run('droid-main', () => 'automation resumed')).resolves.toBe('automation resumed');
  });

});
