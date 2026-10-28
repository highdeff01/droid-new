import { describe, expect, it } from 'vitest';
import { IN_MOTION_SPEED, classifyMobility, predictNextPosition, selfMoveSightings } from './mobility.js';
import type { MappedElement } from './element-map-studio.js';

describe('classifyMobility', () => {
  it('is static with fewer than two sightings or when nothing moved', () => {
    expect(classifyMobility([{ x: 0.3, y: 0.3, time: 0 }])).toEqual({ mobility: 'static', speed: 0 });
    expect(classifyMobility([{ x: 0.3, y: 0.3, time: 0 }, { x: 0.3, y: 0.301, time: 2000 }])).toEqual({ mobility: 'static', speed: 0 });
  });

  it('is in motion when the element travels faster than IN_MOTION_SPEED', () => {
    const r = classifyMobility([{ x: 0.1, y: 0.2, time: 0 }, { x: 0.2, y: 0.2, time: 500 }, { x: 0.3, y: 0.2, time: 1000 }]);
    expect(r.mobility).toBe('in-motion');
    expect(r.speed).toBeCloseTo(0.2);
    expect(r.speed).toBeGreaterThan(IN_MOTION_SPEED);
  });

  it('is user-moved when it jumped once but is slow overall', () => {
    const r = classifyMobility([{ x: 0.4, y: 0.4, time: 0 }, { x: 0.43, y: 0.4, time: 10000 }]);
    expect(r.mobility).toBe('user-moved');
  });

  it('only looks at the most recent five sightings', () => {
    const old = [{ x: 0, y: 0, time: 0 }, { x: 0.9, y: 0.9, time: 100 }];
    const still = Array.from({ length: 5 }, (_, i) => ({ x: 0.5, y: 0.5, time: 1000 + i * 1000 }));
    expect(classifyMobility([...old, ...still]).mobility).toBe('static');
  });
});

describe('predictNextPosition', () => {
  it('extrapolates the velocity of the last two sightings by the lead time', () => {
    const p = predictNextPosition([{ x: 0, y: 0, time: 0 }, { x: 0.2, y: 0.4, time: 1000 }, { x: 0.3, y: 0.35, time: 1500 }], 0.25);
    expect(p!.x).toBeCloseTo(0.35);
    expect(p!.y).toBeCloseTo(0.325);
  });

  it('defaults to a one second lead and clamps to the screen', () => {
    expect(predictNextPosition([{ x: 0.8, y: 0.5, time: 0 }, { x: 0.9, y: 0.45, time: 500 }])).toEqual({ x: 1, y: expect.closeTo(0.35) });
    expect(predictNextPosition([{ x: 0.1, y: 0.1, time: 0 }, { x: 0.05, y: 0.05, time: 100 }])).toEqual({ x: 0, y: 0 });
  });

  it('is null with fewer than two sightings or out-of-order times', () => {
    expect(predictNextPosition([])).toBeNull();
    expect(predictNextPosition([{ x: 0.1, y: 0.1, time: 5 }])).toBeNull();
    expect(predictNextPosition([{ x: 0.1, y: 0.1, time: 5 }, { x: 0.2, y: 0.1, time: 5 }])).toBeNull();
    expect(predictNextPosition([{ x: 0.1, y: 0.1, time: 9 }, { x: 0.2, y: 0.1, time: 5 }])).toBeNull();
  });
});

describe('selfMoveSightings', () => {
  it('lists where each self move landed, ignoring user and AI moves', () => {
    const box = (x: number, y: number) => ({ x, y, w: 0.1, h: 0.1 });
    const el = { moves: [
      { time: 1, cause: 'self', from: box(0, 0), to: box(0.2, 0.2) },
      { time: 2, cause: 'user', from: box(0.2, 0.2), to: box(0.6, 0.6) },
      { time: 3, cause: 'self', from: box(0.6, 0.6), to: box(0.4, 0.2) },
    ] } as unknown as MappedElement;
    const s = selfMoveSightings(el);
    expect(s.map((p) => p.time)).toEqual([1, 3]);
    expect(s[1].x).toBeCloseTo(0.45);
    expect(s[1].y).toBeCloseTo(0.25);
  });
});
