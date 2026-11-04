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

});
