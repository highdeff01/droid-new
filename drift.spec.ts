import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DRIFT,
  MATCHED,
  MATCH_SCALES,
  SEARCH_RADIUS,
  STABLE,
  boundingBox,
  correctDrift,
  diffCells,
  largestCluster,
  matchTemplate,
  patchDistance,
  reverify,
  syncLevelFor,
} from './drift.js';
import { learnCoordinate, learnedSeed } from './coords.js';
import type { Frame } from './types.js';

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

describe('matchTemplate seed', () => {
  it('without a seed, searching near the original spot misses a target moved far away', () => {
    const ref = frameWithBox(0.3 * W, 0.3 * H);
    const live = frameWithBox(0.6 * W, 0.6 * H);
    const r = matchTemplate(ref, live, 0.3, 0.3, { radius: 24 });
    expect(r.matchDistance).toBeGreaterThan(MATCHED);
  });

  it('a seed centred on the moved target finds it with near-zero offset', () => {
    const ref = frameWithBox(0.3 * W, 0.3 * H);
    const live = frameWithBox(0.6 * W, 0.6 * H);
    const r = matchTemplate(ref, live, 0.3, 0.3, { radius: 24, seed: { x: 0.6, y: 0.6 } });
    expect(r.matchDistance).toBeLessThanOrEqual(MATCHED);
    expect(r.dx).toBeCloseTo(0, 1);
    expect(r.dy).toBeCloseTo(0, 1);
  });

  it('a seed near but not exactly on the moved target still resolves to its true position', () => {
    const ref = frameWithBox(0.3 * W, 0.3 * H);
    const live = frameWithBox(0.6 * W, 0.6 * H);
    const r = matchTemplate(ref, live, 0.3, 0.3, { radius: 24, seed: { x: 0.58, y: 0.6 } });
    expect(Math.abs(0.58 + r.dx - 0.6)).toBeLessThanOrEqual(0.01);
  });
});

describe('reverify', () => {  it('reports a change around the target after an action changed the screen', () => {
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

/** A solid-colour 320x180 frame. */
function solid(r: number, g: number, b: number): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}

/** A 320x180 frame with coloured square boxes (pixel in a box iff |x-cx|<half && |y-cy|<half) on a background. */
function boxFrame(boxes: { cx: number; cy: number; half: number; rgb: [number, number, number] }[], bg: [number, number, number] = [20, 20, 20]): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const box = boxes.find((b) => Math.abs(x - b.cx) < b.half && Math.abs(y - b.cy) < b.half);
      const [r, g, b2] = box ? box.rgb : bg;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b2;
      data[i + 3] = 255;
    }
  }
  return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}

/**
 * frameWithBox rescaled by `s` about (cx, cy) with nearest-neighbour sampling: each pixel takes
 * the frameWithBox value at cx + round((x - cx) / s), so it is exactly what a capture of the
 * same target at s times the size looks like.
 */
function scaledBoxFrame(cx: number, cy: number, s: number): ImageData {
  const base = frameWithBox(cx, cy);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = Math.min(W - 1, Math.max(0, cx + Math.round((x - cx) / s)));
      const sy = Math.min(H - 1, Math.max(0, cy + Math.round((y - cy) / s)));
      const i = (y * W + x) * 4;
      const j = (sy * W + sx) * 4;
      data[i] = base.data[j];
      data[i + 1] = base.data[j + 1];
      data[i + 2] = base.data[j + 2];
      data[i + 3] = 255;
    }
  }
  return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}

/** A 320x180 frame: mid-gray (128) background with a 12x12 checkerboard of 0/255 centred at (cx, cy) sample pixels. */
function checkerImage(cx: number, cy: number): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inBlock = Math.abs(x - cx) < 6 && Math.abs(y - cy) < 6;
      const v = inBlock ? ((x + y) % 2 === 0 ? 0 : 255) : 128;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}

describe('patchDistance', () => {
  it('is 0 for identical frames', () => {
    const f = solid(50, 60, 70);
    expect(patchDistance(f, 100, 90, f, 100, 90, 16)).toBe(0);
  });

  it('is 1 for solid black vs solid white', () => {
    const a = solid(0, 0, 0);
    const b = solid(255, 255, 255);
    expect(patchDistance(a, 100, 90, b, 100, 90, 16)).toBeCloseTo(1, 6);
  });

  it('is the RGB RMS distance for solid red vs solid green-ish', () => {
    const a = solid(255, 0, 0);
    const b = solid(0, 130, 0);
    const d = patchDistance(a, 100, 90, b, 100, 90, 16);
    expect(d).toBeGreaterThan(MATCHED);
    expect(d).toBeCloseTo(Math.sqrt((255 ** 2 + 130 ** 2) / 3) / 255, 3);
  });

  it('is the RGB RMS distance for solid red vs solid blue', () => {
    const a = solid(255, 0, 0);
    const b = solid(0, 0, 255);
    const d = patchDistance(a, 100, 90, b, 100, 90, 16);
    expect(d).toBeCloseTo(Math.sqrt(2 / 3), 3);
  });

  it('is null when the reference patch falls outside the frame', () => {
    const a = solid(0, 0, 0);
    const b = solid(0, 0, 0);
    expect(patchDistance(a, 2, 90, b, 90, 90, 16)).toBeNull();
  });

  it('is null when the scaled live patch falls outside the frame, but not at scale 1', () => {
    const a = solid(0, 0, 0);
    const b = solid(0, 0, 0);
    expect(patchDistance(a, 90, 90, b, 8, 90, 16, 1.25)).toBeNull();
    expect(patchDistance(a, 90, 90, b, 8, 90, 16, 1)).not.toBeNull();
  });
});

describe('syncLevelFor', () => {
  it('is green when the region distance is at or under the stable threshold', () => {
    expect(syncLevelFor({ regionDistance: 0.05, matchDistance: 0.05, dx: 0, dy: 0, scale: 1 })).toBe('green');
  });

  it('is yellow when the region distance is above stable but the match distance is at or under matched', () => {
    expect(syncLevelFor({ regionDistance: 0.06, matchDistance: 0.1, dx: 0, dy: 0, scale: 1 })).toBe('yellow');
  });

  it('is red when both distances are above their thresholds', () => {
    expect(syncLevelFor({ regionDistance: 0.06, matchDistance: 0.11, dx: 0, dy: 0, scale: 1 })).toBe('red');
  });

  it('uses custom thresholds when given: green', () => {
    const t = { stable: 0.2, matched: 0.3, radius: 24 };
    expect(syncLevelFor({ regionDistance: 0.15, matchDistance: 0.15, dx: 0, dy: 0, scale: 1 }, t)).toBe('green');
  });

  it('uses custom thresholds when given: yellow', () => {
    const t = { stable: 0.2, matched: 0.3, radius: 24 };
    expect(syncLevelFor({ regionDistance: 0.25, matchDistance: 0.25, dx: 0, dy: 0, scale: 1 }, t)).toBe('yellow');
  });

  it('uses custom thresholds when given: red', () => {
    const t = { stable: 0.2, matched: 0.3, radius: 24 };
    expect(syncLevelFor({ regionDistance: 0.4, matchDistance: 0.31, dx: 0, dy: 0, scale: 1 }, t)).toBe('red');
  });
});

describe('multiScale', () => {
  it('tries same size first, then smaller, then larger', () => {
    expect(MATCH_SCALES).toEqual([1, 0.75, 1.25]);
  });

  it('matches identical frames at scale 1 with no offset', () => {
    const f = scaledBoxFrame(100, 90, 1);
    const r = matchTemplate(f, f, 100 / W, 90 / H);
    expect(r.regionDistance).toBe(0);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
    expect(r.scale).toBe(1);
  });

  it('finds a target grown to 1.25x only when larger scales are searched', () => {
    const ref = scaledBoxFrame(100, 90, 1);
    const live = scaledBoxFrame(100, 90, 1.25);
    const onlyOriginal = matchTemplate(ref, live, 100 / W, 90 / H, { scales: [1] });
    expect(onlyOriginal.matchDistance).toBeGreaterThan(MATCHED);
    const r = matchTemplate(ref, live, 100 / W, 90 / H);
    expect(r.matchDistance).toBeLessThanOrEqual(MATCHED);
    expect(r.scale).toBe(1.25);
    expect(r.regionDistance).toBeGreaterThan(STABLE);
  });

  it('finds a target shrunk to 0.75x', () => {
    const ref = scaledBoxFrame(100, 90, 4 / 3);
    const live = scaledBoxFrame(100, 90, 1);
    const onlyOriginal = matchTemplate(ref, live, 100 / W, 90 / H, { scales: [1] });
    expect(onlyOriginal.matchDistance).toBeGreaterThan(MATCHED);
    const r = matchTemplate(ref, live, 100 / W, 90 / H);
    expect(r.scale).toBe(0.75);
    expect(r.matchDistance).toBeLessThanOrEqual(MATCHED);
  });

  it('finds a target that both moved and changed scale', () => {
    const ref = scaledBoxFrame(100, 90, 1);
    const live = scaledBoxFrame(110, 96, 1.25);
    const r = matchTemplate(ref, live, 100 / W, 90 / H);
    expect(Math.abs(100 / W + r.dx - 110 / W)).toBeLessThanOrEqual(2 / W);
    expect(Math.abs(90 / H + r.dy - 96 / H)).toBeLessThanOrEqual(2 / H);
  });
});

describe('driftSettings', () => {
  it('exposes the default thresholds and radius', () => {
    expect(STABLE).toBe(0.05);
    expect(MATCHED).toBe(0.1);
    expect(SEARCH_RADIUS).toBe(24);
    expect(DEFAULT_DRIFT).toEqual({ stable: 0.05, matched: 0.1, radius: 24 });
  });

  it('a tighter matched threshold turns a found match to red', () => {
    const ref = frameWithBox(100, 60);
    const moved = frameWithBox(110, 66);
    // The moved target is 10 levels brighter: a 10/255 ≈ 0.039 match, within the default 0.1 but not within 0.01.
    const live = { ...moved, data: moved.data.map((v, i) => (i % 4 === 3 ? v : v + 10)) } as ImageData;
    expect(correctDrift(ref, live, 100 / W, 60 / H, 1920, 1080).level).toBe('yellow');
    const c = correctDrift(ref, live, 100 / W, 60 / H, 1920, 1080, { ...DEFAULT_DRIFT, matched: 0.01 });
    expect(c.level).toBe('red');
    expect(c.driftPx).toBe(0);
  });

  it('a smaller radius misses a target beyond it even after widening', () => {
    const ref = frameWithBox(100, 60);
    const live = frameWithBox(140, 60);
    const def = correctDrift(ref, live, 100 / W, 60 / H, 1920, 1080);
    expect(def.level).toBe('yellow');
    expect(def.widened).toBe(true);
    expect(def.dxPx).toBe(240);
    const c = correctDrift(ref, live, 100 / W, 60 / H, 1920, 1080, { ...DEFAULT_DRIFT, radius: 4 });
    expect(c.level).toBe('red');
  });

  it('finds the correctly-coloured target among a same-shade decoy at the original spot', () => {
    const ref = boxFrame([{ cx: 100, cy: 60, half: 6, rgb: [255, 0, 0] }]);
    const live = boxFrame([
      { cx: 100, cy: 60, half: 6, rgb: [0, 130, 0] },
      { cx: 116, cy: 60, half: 6, rgb: [255, 0, 0] },
    ]);
    const c = correctDrift(ref, live, 100 / W, 60 / H, 1920, 1080);
    expect(c.level).toBe('yellow');
    expect(c.dxPx).toBe(96);
    expect(c.dyPx).toBe(0);
  });
});

describe('clusterDetection', () => {
  it('finds no changed cells between identical frames', () => {
    const f = frameWithBox(100, 60);
    expect(diffCells(f, f)).toEqual([]);
  });

  it('picks the largest 4-connected group of cells', () => {
    const cells = [
      { col: 0, row: 0, distance: 0.5 },
      { col: 1, row: 0, distance: 0.5 },
      { col: 1, row: 1, distance: 0.5 },
      { col: 5, row: 5, distance: 0.5 },
      { col: 2, row: 2, distance: 0.5 },
    ];
    const cluster = largestCluster(cells);
    expect([...cluster].sort((a, b) => a.col - b.col || a.row - b.row)).toEqual([
      { col: 0, row: 0, distance: 0.5 },
      { col: 1, row: 0, distance: 0.5 },
      { col: 1, row: 1, distance: 0.5 },
    ]);
  });

  it('is empty for no cells', () => {
    expect(largestCluster([])).toEqual([]);
  });

  it('diffCells, largestCluster and boundingBox agree on a changed region plus an isolated cell', () => {
    const a = solid(0, 0, 0);
    const b = boxFrame(
      [
        { cx: 2 * 20 + 10, cy: 1 * 20 + 10, half: 10, rgb: [255, 255, 255] },
        { cx: 3 * 20 + 10, cy: 1 * 20 + 10, half: 10, rgb: [255, 255, 255] },
        { cx: 4 * 20 + 10, cy: 1 * 20 + 10, half: 10, rgb: [255, 255, 255] },
        { cx: 3 * 20 + 10, cy: 2 * 20 + 10, half: 10, rgb: [255, 255, 255] },
        { cx: 10 * 20 + 10, cy: 7 * 20 + 10, half: 10, rgb: [255, 255, 255] },
      ],
      [0, 0, 0],
    );
    const cells = diffCells(a, b);
    expect(cells).toHaveLength(5);
    const cluster = largestCluster(cells);
    expect(cluster).toHaveLength(4);
    expect(boundingBox(cluster)).toEqual({ x: 2 / 16, y: 1 / 9, w: 3 / 16, h: 2 / 9 });
  });
});

describe('coordinateSeeding', () => {
  it('learns a target from a frame literal and relocates it on a frame where it moved', () => {
    const data = checkerImage(150, 90);
    const frame: Frame = { id: 1, time: 0, url: '', data, srcW: 1920, srcH: 1080, source: 'desktop' };
    const { list } = learnCoordinate([], { name: 'Button', x: 150 / W, y: 90 / H, frame, time: 1 });
    const el = list[0];
    const r = learnedSeed(el, checkerImage(170, 90));
    expect(r).not.toBeNull();
    expect(Math.abs(r!.x - 170 / W)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(r!.y - 90 / H)).toBeLessThanOrEqual(0.01);
  });

  it('matches a target by colour when seeded near its moved location', () => {
    const ref = boxFrame([{ cx: 96, cy: 54, half: 6, rgb: [255, 0, 0] }]);
    const live = boxFrame([{ cx: 192, cy: 108, half: 6, rgb: [255, 0, 0] }]);
    const r = matchTemplate(ref, live, 0.3, 0.3, { radius: 24, seed: { x: 0.6, y: 0.6 } });
    expect(r.matchDistance).toBeLessThanOrEqual(MATCHED);
    expect(r.dx).toBeCloseTo(0, 1);
    expect(r.dy).toBeCloseTo(0, 1);
  });
});
