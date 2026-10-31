import { describe, expect, it } from 'vitest';
import { INTERVAL_MAX_MS, INTERVAL_MIN_MS, QUALITY_MAX, QUALITY_MIN, frameBytes, frameOrder, planChanged, planStream, streamLine, type FrameConsumer } from './frame-stream.js';

const consumer = (id: string, budgetBytes: number, use: FrameConsumer['use'] = 'monitoring'): FrameConsumer => ({ id, budgetBytes, use });

describe('planStream', () => {
  it('idles at the slowest rate with no consumers', () => {
    const p = planStream([]);
    expect(p).toMatchObject({ consumers: 0, intervalMs: INTERVAL_MAX_MS, quality: QUALITY_MIN });
  });

  it('ignores consumers that are not pulling', () => {
    expect(planStream([consumer('idle', 0)]).consumers).toBe(0);
  });

  it('serves verification at the fastest rate, so a check is never starved by a watcher', () => {
    const verification = planStream([consumer('v', 1_000_000, 'verification')]);
    const monitoring = planStream([consumer('m', 1_000_000, 'monitoring')]);
    expect(verification.intervalMs).toBe(INTERVAL_MIN_MS);
    expect(verification.intervalMs).toBeLessThan(monitoring.intervalMs);
    expect(verification.reason).toContain('verification');
  });

  it('lowers quality when the budget is tight', () => {
    const rich = planStream([consumer('a', 10_000_000, 'verification')]);
    const poor = planStream([consumer('a', 300_000, 'verification')]);
    expect(poor.quality).toBeLessThan(rich.quality);
    expect(poor.reason).toContain('budget tight');
  });

  it('keeps quality within the allowed range', () => {
    expect(planStream([consumer('a', 1)]).quality).toBeGreaterThanOrEqual(QUALITY_MIN);
    expect(planStream([consumer('a', 1e12)]).quality).toBeLessThanOrEqual(QUALITY_MAX);
  });

  it('degrades gracefully as more consumers join', () => {
    const one = planStream([consumer('a', 1_000_000, 'verification')]);
    const many = planStream([consumer('a', 250_000, 'verification'), consumer('b', 250_000, 'verification'), consumer('c', 250_000, 'verification')]);
    expect(many.consumers).toBe(3);
    expect(many.quality).toBeLessThan(one.quality);
  });
});

describe('frameOrder', () => {
  it('puts verification frames before monitoring ones, oldest first within a class', () => {
    const order = frameOrder([
      { consumer: 'm1', use: 'monitoring', at: 1 },
      { consumer: 'v1', use: 'verification', at: 5 },
      { consumer: 'v2', use: 'verification', at: 2 },
    ]);
    expect(order.map((r) => r.consumer)).toEqual(['v2', 'v1', 'm1']);
  });
});

describe('frameBytes', () => {
  it('scales with quality', () => {
    expect(frameBytes(QUALITY_MIN)).toBeLessThan(frameBytes(QUALITY_MAX));
  });
});

describe('planChanged / streamLine', () => {
  it('detects a changed plan and reports the first one', () => {
    const a = planStream([consumer('a', 1_000_000)]);
    expect(planChanged(null, a)).toBe(true);
    expect(planChanged(a, a)).toBe(false);
    expect(planChanged(a, planStream([consumer('a', 1_000_000, 'verification')]))).toBe(true);
  });

  it('renders one line', () => {
    expect(streamLine(planStream([consumer('a', 1_000_000)]))).toContain('Frame stream:');
  });
});
