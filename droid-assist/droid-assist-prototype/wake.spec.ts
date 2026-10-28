import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Frame } from './types.js';
import { decisionSystem } from './wake-decision.js';
import {
  DEFAULT_WAKE_MS,
  WAKE_MS_MAX,
  createWakeSession,
  wakeDelay,
  wakeRequest,
  watchInterval,
} from './wake.js';
import type { WakeCapture, WaitContext } from './wake.js';

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

let nextId = 1;
const mkFrame = (): Frame => ({
  id: nextId++,
  time: Date.now(),
  url: 'data:,',
  data: new ImageData(new Uint8ClampedArray(320 * 180 * 4), 320, 180),
  srcW: 1920,
  srcH: 1080,
  source: 'demo',
});

afterEach(() => vi.useRealTimers());

describe('wakeDelay', () => {
  it('uses the default wake timer when the user gives none and the AI gives none', () => {
    expect(wakeDelay(DEFAULT_WAKE_MS)).toBe(DEFAULT_WAKE_MS);
  });

  it('lets a longer AI estimate win over the user timer', () => {
    expect(wakeDelay(30000, 90000)).toBe(90000);
  });

  it('never lets a shorter AI estimate shorten the user timer', () => {
    expect(wakeDelay(30000, 10000)).toBe(30000);
  });

  it.each([
    ['NaN', Number.NaN],
    ['negative', -5000],
    ['undefined', undefined],
  ])('uses the user value when the AI time is %s', (_label, aiMs) => {
    expect(wakeDelay(30000, aiMs)).toBe(30000);
  });

  it('caps the AI time at WAKE_MS_MAX', () => {
    expect(wakeDelay(5000, 700000)).toBe(WAKE_MS_MAX);
  });
});

describe('watchInterval', () => {
  it('is a quarter of a 30s delay', () => {
    expect(watchInterval(30000)).toBe(7500);
  });

  it('floors at 1s for a short delay', () => {
    expect(watchInterval(2000)).toBe(1000);
  });

  it('is always shorter than the delay', () => {
    for (const delay of [2000, 5000, 30000, 100000]) {
      expect(watchInterval(delay)).toBeLessThan(delay);
    }
  });
});

describe('createWakeSession', () => {
  it('fires the timer once with cause timer when the check reports nothing', async () => {
    vi.useFakeTimers();
    const onWake = vi.fn();
    const check = vi.fn(async () => null);
    const session = createWakeSession({ delay: 1000, interval: 200, check, onWake });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(onWake).toHaveBeenCalledWith({ cause: 'timer', detail: '' });
    expect(session.done).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it('wakes early with cause change and the detail when the check reports one, and the timer never fires again', async () => {
    vi.useFakeTimers();
    const onWake = vi.fn();
    const check = vi.fn(async () => 'popup appeared');
    const session = createWakeSession({ delay: 1000, interval: 200, check, onWake });
    await vi.advanceTimersByTimeAsync(200);
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(onWake).toHaveBeenCalledWith({ cause: 'change', detail: 'popup appeared' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(session.done).toBe(true);
  });

  it('wakes with cause error when the check throws', async () => {
    vi.useFakeTimers();
    const onWake = vi.fn();
    const check = vi.fn(async () => {
      throw new Error('capture failed');
    });
    createWakeSession({ delay: 1000, interval: 200, check, onWake });
    await vi.advanceTimersByTimeAsync(200);
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(onWake).toHaveBeenCalledWith({ cause: 'error', detail: 'capture failed' });
  });

  it('fires nothing when cancelled before the delay', async () => {
    vi.useFakeTimers();
    const onWake = vi.fn();
    const check = vi.fn(async () => null);
    const session = createWakeSession({ delay: 1000, interval: 200, check, onWake });
    session.cancel();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onWake).not.toHaveBeenCalled();
    expect(session.done).toBe(true);
  });
});

describe('wakeRequest', () => {
  const ctx = (): WaitContext => ({
    goal: 'Export the report',
    step: 'Click Save',
    waitingOn: 'the save dialog to close',
    since: Date.now() - 5000,
    delay: 30000,
    before: [mkFrame(), mkFrame()],
    beforeInfo: ['clicked Save'],
  });
  const cap = (): WakeCapture => ({ fresh: [mkFrame(), mkFrame()], freshInfo: ['dialog open'] });

  it('assembles the fresh frame, the before/fresh frames and context, and a prompt naming goal/step/waitingOn', () => {
    const c = ctx();
    const k = cap();
    const req = wakeRequest(c, k, { cause: 'timer', detail: '' });
    expect(req.frame).toBe(k.fresh[0]);
    expect(req.frames).toEqual([k.fresh[1], c.before[0], c.before[1]]);
    expect(req.context).toContain('[before wait] clicked Save');
    expect(req.context).toContain('[after wait] dialog open');
    expect(req.prompt).toContain(c.waitingOn);
    expect(req.prompt).toContain(c.step);
    expect(req.prompt).toContain(c.goal);
    expect(req.json).toBe(true);
    expect(req.system).toBe(decisionSystem);
  });

  it('mentions the change detail and that it woke early, on a change cause', () => {
    const req = wakeRequest(ctx(), cap(), { cause: 'change', detail: 'popup appeared' });
    expect(req.prompt).toContain('popup appeared');
    expect(req.prompt).toContain('early');
  });

  it('mentions the error detail, on an error cause', () => {
    const req = wakeRequest(ctx(), cap(), { cause: 'error', detail: 'capture failed' });
    expect(req.prompt).toContain('capture failed');
  });

  it('gives a null frame when the fresh list is empty', () => {
    const req = wakeRequest(ctx(), { fresh: [], freshInfo: [] }, { cause: 'timer', detail: '' });
    expect(req.frame).toBeNull();
  });
});
