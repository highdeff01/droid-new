import { describe, expect, it } from 'vitest';
import type { Calibration } from './calibration.js';
import { makeBaseline, recalibrate, remapPoint, widestPair } from './calibration.js';
import type { MappedElement } from './element-map.js';
import type { Frame } from './types.js';

const W = 320;
const H = 180;

/** A dark 320x180 sample frame with two distinct reference boxes: a bright square at (ax, ay) and a mid-grey bar at (bx, by), each with a side marker (as in drift.spec) so template matching can localize it precisely. */
function frameWithBoxes(ax: number, ay: number, av: number, bx: number, by: number, bv: number): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  const shade = (cx: number, cy: number, v: number, x: number, y: number) => {
    const inBox = Math.abs(x - cx) < 6 && Math.abs(y - cy) < 6;
    const inMark = x - cx >= 6 && x - cx < 10 && Math.abs(y - cy) < 3;
    return inBox ? v : inMark ? v - 80 : null;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = shade(ax, ay, av, x, y) ?? shade(bx, by, bv, x, y) ?? 20;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}

const frame = (srcW: number, srcH: number, data: ImageData): Frame => ({ id: 1, time: 0, url: '', data, srcW, srcH, source: 'desktop' });

// Reference pair: a bright square "A" at sample (80, 90) and a mid-grey bar "B" at sample (160, 90).
const baseFrameData = frameWithBoxes(80, 90, 240, 160, 90, 140);
const baseFrame = frame(1920, 1080, baseFrameData);
const pairMap: MappedElement[] = [
  { name: 'A', x: 80 / W, y: 90 / H, origin: 'step' },
  { name: 'B', x: 160 / W, y: 90 / H, origin: 'step' },
];

describe('widestPair', () => {
  it('returns null when there are fewer than two elements', () => {
    expect(widestPair([])).toBeNull();
    expect(widestPair([pairMap[0]])).toBeNull();
  });

  it('picks the two elements farthest apart', () => {
    const middle: MappedElement = { name: 'mid', x: 0.5, y: 0.5, origin: 'step' };
    const corner: MappedElement = { name: 'corner', x: 0.1, y: 0.1, origin: 'step' };
    const far: MappedElement = { name: 'far', x: 0.9, y: 0.9, origin: 'step' };
    expect(widestPair([corner, middle, far])).toEqual([corner, far]);
  });
});

describe('makeBaseline', () => {
  it('records the widest mapped pair and the grid cell size', () => {
    const base = makeBaseline(baseFrame, pairMap);
    expect(base.a?.name).toBe('A');
    expect(base.b?.name).toBe('B');
    expect(base.cellW).toBeCloseTo(1920 / 16);
    expect(base.cellH).toBeCloseTo(1080 / 9);
  });
});

describe('recalibrate', () => {
  it('reports no drift for a pair baseline measured against the same frame', () => {
    const base = makeBaseline(baseFrame, pairMap);
    const cal = recalibrate(base, baseFrame);
    expect(cal.method).toBe('pair');
    expect(cal.scaleX).toBeCloseTo(1);
    expect(cal.drift).toBe(false);
  });

  it('detects drift and a grown scale when the reference pair moved further apart', () => {
    const base = makeBaseline(baseFrame, pairMap);
    const live = frame(1920, 1080, frameWithBoxes(80, 90, 240, 200, 90, 140));
    const cal = recalibrate(base, live);
    expect(cal.method).toBe('pair');
    expect(cal.drift).toBe(true);
    expect(cal.scaleX).toBeCloseTo(1.5, 1);
  });

  it('falls back to grid calibration and flags a resolution change when there is no reference pair', () => {
    const base = makeBaseline(frame(1920, 1080, baseFrameData), []);
    const live = frame(2560, 1440, baseFrameData);
    const cal = recalibrate(base, live);
    expect(cal.method).toBe('grid');
    expect(cal.resolutionChanged).toBe(true);
    expect(cal.drift).toBe(true);
    expect(cal.scaleX).toBeCloseTo(2560 / 1920, 1);
  });

  it('reports no drift via grid calibration when the resolution is unchanged', () => {
    const base = makeBaseline(frame(1920, 1080, baseFrameData), []);
    const live = frame(1920, 1080, baseFrameData);
    const cal = recalibrate(base, live);
    expect(cal.method).toBe('grid');
    expect(cal.resolutionChanged).toBe(false);
    expect(cal.drift).toBe(false);
  });
});

describe('remapPoint', () => {
  const pairCal: Calibration = {
    method: 'pair',
    scaleX: 1.5,
    scaleY: 1,
    from: { x: 0.25, y: 0.5 },
    to: { x: 0.25, y: 0.5 },
    resolutionChanged: false,
    drift: true,
    detail: '',
  };

  it('rescales a point around the anchor for a pair calibration', () => {
    const p = remapPoint(pairCal, { x: 0.5, y: 0.5 });
    expect(p.x).toBeCloseTo(0.625);
    expect(p.y).toBeCloseTo(0.5);
  });

  it('clamps the rescaled point so it never exceeds 1', () => {
    const p = remapPoint(pairCal, { x: 0.9, y: 0.5 });
    expect(p.x).toBe(1);
  });

  it('leaves normalized points unchanged for a grid calibration', () => {
    const gridCal: Calibration = { ...pairCal, method: 'grid' };
    const p = remapPoint(gridCal, { x: 0.9, y: 0.3 });
    expect(p).toEqual({ x: 0.9, y: 0.3 });
  });
});
