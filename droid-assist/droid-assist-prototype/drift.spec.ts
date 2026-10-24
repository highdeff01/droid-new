import { describe, expect, it } from 'vitest';
import { correctDrift, reverify } from './drift.js';

const W = 320;
const H = 180;

/** A dark frame with a bright 12×12 square (and a dimmer marker beside it) centred at (cx, cy) sample pixels. */
function frameWithBox(cx: number, cy: number): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inBox = Math.abs(x - cx) < 6 && Math.abs(y - cy) < 6;
      const inMark = x - cx >= 6 && x - cx < 10 && Math.abs(y - cy) < 3;
      const v = inBox ? 240 : inMark ? 140 : 20;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}

function noise(seed: number): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  let s = seed;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    data[i] = i % 4 === 3 ? 255 : s & 255;
  }
  return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}

describe('correctDrift', () => {
  it('reports no drift when the target has not moved', () => {
    const ref = frameWithBox(100, 60);
    const c = correctDrift(ref, ref, 100 / W, 60 / H, 1920, 1080);
    expect(c.level).toBe('green');
    expect(c.driftPx).toBe(0);
    expect(c.x).toBeCloseTo(100 / W);
  });

  it('finds a moved target and reports the correction in native pixels', () => {
    const ref = frameWithBox(100, 60);
    const live = frameWithBox(110, 66);
    const c = correctDrift(ref, live, 100 / W, 60 / H, 1920, 1080);
    expect(c.level).toBe('yellow');
    expect(c.dxPx).toBe(60);
    expect(c.dyPx).toBe(36);
    expect(c.driftPx).toBe(70);
    expect(c.x).toBeCloseTo(110 / W);
    expect(c.y).toBeCloseTo(66 / H);
  });

  it('widens the search when the UI moved beyond the normal radius', () => {
    const ref = frameWithBox(100, 90);
    const live = frameWithBox(150, 90);
    const c = correctDrift(ref, live, 100 / W, 90 / H, 320, 180);
    expect(c.widened).toBe(true);
    expect(c.level).toBe('yellow');
    expect(c.dxPx).toBe(50);
  });

  it('is red and applies no correction when the target is gone', () => {
    const ref = frameWithBox(100, 60);
    const c = correctDrift(ref, noise(7), 100 / W, 60 / H, 1920, 1080);
    expect(c.level).toBe('red');
    expect(c.driftPx).toBe(0);
    expect(c.x).toBeCloseTo(100 / W);
  });
});

describe('reverify', () => {
  it('reports a change around the target after an action changed the screen', () => {
    const r = reverify(frameWithBox(100, 60), frameWithBox(200, 120), 100 / W, 60 / H);
    expect(r.changed).toBe(true);
    expect(r.targetChange).toBeGreaterThan(0.02);
  });

  it('reports no change when the screen is identical', () => {
    const f = frameWithBox(100, 60);
    const r = reverify(f, f, 100 / W, 60 / H);
    expect(r.changed).toBe(false);
    expect(r.frameChange).toBe(0);
  });
});
