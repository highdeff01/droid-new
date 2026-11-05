import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURSOR_HOME, MARKER_OF, PATH_FRAMES, createCursorAnimator, humanPath } from './cursor-path.js';
import type { TrailPoint } from './types.js';

afterEach(() => vi.useRealTimers());

describe('humanPath', () => {
  it('interpolates PATH_FRAMES (10–15) points that move toward the target and end exactly on it', () => {
    const path = humanPath({ x: 0.1, y: 0.2 }, { x: 0.7, y: 0.6 }, () => 0.9);
    expect(PATH_FRAMES).toBeGreaterThanOrEqual(10);
    expect(PATH_FRAMES).toBeLessThanOrEqual(15);
    expect(path).toHaveLength(PATH_FRAMES);
    expect(path[path.length - 1]).toEqual({ x: 0.7, y: 0.6 });
    const dist = path.map((p) => Math.hypot(0.7 - p.x, 0.6 - p.y));
    for (let i = 1; i < dist.length; i++) expect(dist[i]).toBeLessThan(dist[i - 1]);
  });

  it('bows off the straight line like a hand movement', () => {
    const path = humanPath({ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, () => 1);
    expect(path.some((p) => Math.abs(p.y - 0.5) > 0.01)).toBe(true);
  });
});

describe('MARKER_OF', () => {
  it('click dots for click/double_click, a typing marker for type, nothing for move/scroll/drag', () => {
    expect(MARKER_OF.click).toBe('click');
    expect(MARKER_OF.double_click).toBe('click');
    expect(MARKER_OF.type).toBe('typed');
    expect(MARKER_OF.move).toBeUndefined();
    expect(MARKER_OF.scroll).toBeUndefined();
    expect(MARKER_OF.drag).toBeUndefined();
  });
});

describe('createCursorAnimator', () => {
  function setup(random = () => 0) {
    const frames: Array<{ x: number; y: number }> = [];
    const marks: TrailPoint[] = [];
    const a = createCursorAnimator({ frame: (p) => frames.push(p), mark: (p) => marks.push(p), random });
    return { a, frames, marks };
  }

  it('plays each attempt over humanMoveMs (250 ms at random 0), never teleporting', async () => {
    vi.useFakeTimers();
    const { a, frames } = setup(() => 0);
    a.aim({ x: 0.8, y: 0.2 });
    expect(frames).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.length).toBeLessThan(PATH_FRAMES);
    await vi.advanceTimersByTimeAsync(200);
    expect(frames).toHaveLength(PATH_FRAMES);
    expect(frames[frames.length - 1]).toEqual({ x: 0.8, y: 0.2 });
  });

  it('takes 550 ms at random 1', async () => {
    vi.useFakeTimers();
    const { a, frames } = setup(() => 1);
    a.aim({ x: 0.8, y: 0.2 });
    await vi.advanceTimersByTimeAsync(400);
    expect(frames.length).toBeLessThan(PATH_FRAMES);
    await vi.advanceTimersByTimeAsync(200);
    expect(frames).toHaveLength(PATH_FRAMES);
  });

  it('starts from the screen centre, then chains attempts: planned, then drift-corrected', async () => {
    const { a, frames } = setup();
    a.aim({ x: 0.2, y: 0.2 });
    a.aim({ x: 0.25, y: 0.3 });
    await a.idle();
    expect(frames).toHaveLength(PATH_FRAMES * 2);
    expect(frames[PATH_FRAMES - 1]).toEqual({ x: 0.2, y: 0.2 });
    expect(frames[frames.length - 1]).toEqual({ x: 0.25, y: 0.3 });
    expect(Math.hypot(frames[0].x - CURSOR_HOME.x, frames[0].y - CURSOR_HOME.y)).toBeLessThan(0.1);
  });

  it('skips a repeat aim at the same point and puts markers where the cursor is', async () => {
    const { a, frames, marks } = setup();
    a.aim({ x: 0.4, y: 0.4 });
    a.aim({ x: 0.4, y: 0.4 });
    a.mark('click');
    a.mark('typed');
    await a.idle();
    expect(frames).toHaveLength(PATH_FRAMES);
    expect(marks).toEqual([expect.objectContaining({ x: 0.4, y: 0.4, click: true }), expect.objectContaining({ x: 0.4, y: 0.4, typed: true })]);
    expect(marks[1].click).toBeUndefined();
    expect(a.where()).toEqual({ x: 0.4, y: 0.4 });
  });
});
