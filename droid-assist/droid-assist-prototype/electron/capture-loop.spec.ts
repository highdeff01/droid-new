// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bgraToRgba, startCaptureLoop, type CaptureLoop } from './capture-loop.js';
import type { NativeFrame } from './capture-api.js';

const frame = (): NativeFrame => ({ time: Date.now(), url: 'data:image/jpeg;base64,', pixels: new Uint8Array(4), srcW: 1920, srcH: 1080 });

describe('startCaptureLoop', () => {
  let loop: CaptureLoop | undefined;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    loop?.stop();
    vi.useRealTimers();
  });

  const run = (intervalMs: number, grab = vi.fn(async () => frame())) => {
    const sink = { frame: vi.fn(), error: vi.fn() };
    loop = startCaptureLoop(grab, sink, intervalMs);
    return { sink, grab };
  };

  it('captures about once per second at the 1s background monitor rate', async () => {
    const { sink } = run(1000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sink.frame.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(sink.frame.mock.calls.length).toBeLessThanOrEqual(11);
  });

  it('captures four times per second at the 0.25s advanced monitor rate', async () => {
    const { sink } = run(250);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sink.frame.mock.calls.length).toBeGreaterThanOrEqual(40);
    expect(sink.frame.mock.calls.length).toBeLessThanOrEqual(41);
  });

  it('clamps intervals below 250ms', async () => {
    const { sink } = run(100);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sink.frame.mock.calls.length).toBeLessThanOrEqual(41);
  });

  it('never overlaps a slow grab', async () => {
    let inFlight = 0;
    let peak = 0;
    const grab = vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 600));
      inFlight--;
      return frame();
    });
    run(250, grab);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(peak).toBe(1);
    expect(grab.mock.calls.length).toBeGreaterThanOrEqual(8);
  });

  it('reports a failed grab once and stops', async () => {
    let n = 0;
    const grab = vi.fn(async () => {
      if (++n === 3) throw new Error('boom');
      return frame();
    });
    const { sink } = run(250, grab);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sink.error).toHaveBeenCalledTimes(1);
    expect(sink.error).toHaveBeenCalledWith('boom');
    expect(grab).toHaveBeenCalledTimes(3);
    expect(sink.frame).toHaveBeenCalledTimes(2);
  });

  it('changes rate live with setInterval', async () => {
    const { sink } = run(1000);
    await vi.advanceTimersByTimeAsync(3_000);
    const before = sink.frame.mock.calls.length;
    loop!.setInterval(250);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sink.frame.mock.calls.length - before).toBeGreaterThanOrEqual(7);
  });

  it('stops delivering after stop()', async () => {
    const { sink, grab } = run(250);
    await vi.advanceTimersByTimeAsync(1_000);
    loop!.stop();
    const frames = sink.frame.mock.calls.length;
    const grabs = grab.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sink.frame.mock.calls.length).toBe(frames);
    expect(grab.mock.calls.length).toBe(grabs);
  });
});

describe('bgraToRgba', () => {
  it('swaps the blue and red channels', () => {
    expect(Array.from(bgraToRgba(new Uint8Array([1, 2, 3, 4, 10, 20, 30, 40])))).toEqual([3, 2, 1, 4, 30, 20, 10, 40]);
  });
});
