import { describe, expect, it } from 'vitest';
import {
  COORD_MOVE_EPS,
  DWELL_MS,
  DWELL_RADIUS,
  detectDwell,
  dwellObservation,
  learnCoordinate,
  learnedSeed,
  learnedTargets,
} from './coords.js';
import { ANCHOR_PATCH } from './habits.js';
import type { FamiliarElement, Frame, TrailPoint } from './types.js';

const W = 320;
const H = 180;

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
  return { data, width: W, height: H, colorSpace: 'srgb' } as ImageData;
}

/** A flat mid-gray frame with no distinctive block anywhere. */
function flatImage(): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = 128;
    data[i + 3] = 255;
  }
  return { data, width: W, height: H, colorSpace: 'srgb' } as ImageData;
}

const frame = (id: number, data: ImageData): Frame => ({ id, time: 0, url: '', data, srcW: 1920, srcH: 1080, source: 'desktop' });

/** Learns "Button" at (cx, cy) sample pixels on a fresh frame and returns the stored entry. */
function learnedAt(cx: number, cy: number): FamiliarElement {
  const { list } = learnCoordinate([], { name: 'Button', x: cx / W, y: cy / H, frame: frame(1, checkerImage(cx, cy)), time: 1 });
  return list[0];
}

describe('learnCoordinate', () => {
  it('adds a new entry with timesSeen 1, frameId and an anchor patch on first observation', () => {
    const frameA = frame(9, checkerImage(150, 90));
    const { list } = learnCoordinate([], { name: 'Button', x: 150 / W, y: 90 / H, frame: frameA, time: 123 });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ timesSeen: 1, frameId: frameA.id, lastSeen: 123 });
    expect(list[0].anchor).toHaveLength(ANCHOR_PATCH * ANCHOR_PATCH);
  });

  it('merges a repeat observation of the same name (any case/whitespace) into one entry with timesSeen 2 at the new point', () => {
    const first = learnCoordinate([], { name: 'Button', x: 150 / W, y: 90 / H, frame: frame(1, checkerImage(150, 90)), time: 1 });
    const { list } = learnCoordinate(first.list, { name: ' BUTTON ', x: 170 / W, y: 90 / H, frame: frame(2, checkerImage(170, 90)), time: 2 });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ timesSeen: 2, x: 170 / W, y: 90 / H });
  });

  it('reports no move when the coordinates are unchanged', () => {
    const first = learnCoordinate([], { name: 'X', x: 0.5, y: 0.5, frame: null, time: 1 });
    const { moved } = learnCoordinate(first.list, { name: 'X', x: 0.5, y: 0.5, frame: null, time: 2 });
    expect(moved).toBeNull();
  });

  it('reports the move when the coordinates changed beyond COORD_MOVE_EPS', () => {
    const first = learnCoordinate([], { name: 'X', x: 0.5, y: 0.5, frame: null, time: 1 });
    const { moved } = learnCoordinate(first.list, { name: 'X', x: 0.7, y: 0.5, frame: null, time: 2 });
    expect(moved).toEqual({ name: 'X', from: { x: 0.5, y: 0.5 }, to: { x: 0.7, y: 0.5 } });
  });

  it('reports no move for a change at or under COORD_MOVE_EPS', () => {
    const first = learnCoordinate([], { name: 'X', x: 0.5, y: 0.5, frame: null, time: 1 });
    const { moved } = learnCoordinate(first.list, { name: 'X', x: 0.5 + COORD_MOVE_EPS, y: 0.5, frame: null, time: 2 });
    expect(moved).toBeNull();
  });

  it('leaves the list unchanged for a blank name', () => {
    const list: FamiliarElement[] = [{ id: 'el1', name: 'Button', x: 0.1, y: 0.1, lastSeen: 1 }];
    const { list: out, moved } = learnCoordinate(list, { name: '   ', x: 0.5, y: 0.5, frame: null, time: 1 });
    expect(out).toBe(list);
    expect(moved).toBeNull();
  });

  it('merges into an existing familiar element without timesSeen, keeping its id and patch and setting timesSeen 1', () => {
    const existing: FamiliarElement = { id: 'existing1', name: 'Button', x: 0.1, y: 0.1, lastSeen: 1, patch: 'data:image/jpeg;base64,QQ' };
    const { list } = learnCoordinate([existing], { name: 'Button', x: 0.2, y: 0.3, frame: null, time: 99 });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'existing1', patch: 'data:image/jpeg;base64,QQ', timesSeen: 1 });
  });
});

describe('learnedTargets', () => {
  it('returns only entries the learner has observed (timesSeen > 0)', () => {
    const list: FamiliarElement[] = [
      { id: 'a', name: 'A', x: 0.1, y: 0.1, lastSeen: 1 },
      { id: 'b', name: 'B', x: 0.2, y: 0.2, lastSeen: 1, timesSeen: 0 },
      { id: 'c', name: 'C', x: 0.3, y: 0.3, lastSeen: 1, timesSeen: 2 },
    ];
    expect(learnedTargets(list).map((e) => e.id)).toEqual(['c']);
  });
});

describe('learnedSeed', () => {
  it('relocates a target moved within the near search radius', () => {
    const el = learnedAt(150, 90);
    const r = learnedSeed(el, checkerImage(170, 90));
    expect(r).not.toBeNull();
    expect(Math.abs(r!.x - 170 / W)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(r!.y - 90 / H)).toBeLessThanOrEqual(0.01);
  });

  it('still finds a target moved only within the wide search radius', () => {
    const el = learnedAt(150, 90);
    const r = learnedSeed(el, checkerImage(200, 90));
    expect(r).not.toBeNull();
    expect(Math.abs(r!.x - 200 / W)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(r!.y - 90 / H)).toBeLessThanOrEqual(0.01);
  });

  it('returns null without an anchor', () => {
    const el: FamiliarElement = { id: 'e', name: 'X', x: 150 / W, y: 90 / H, lastSeen: 1 };
    expect(learnedSeed(el, checkerImage(150, 90))).toBeNull();
  });

  it('returns null when the target is absent from the live frame', () => {
    const el = learnedAt(150, 90);
    expect(learnedSeed(el, flatImage())).toBeNull();
  });
});

describe('detectDwell', () => {
  it('returns null while the cursor keeps moving', () => {
    const points: TrailPoint[] = [
      { x: 0, y: 0, t: 0 },
      { x: 0.1, y: 0, t: 100 },
      { x: 0.2, y: 0, t: 200 },
      { x: 0.3, y: 0, t: 300 },
    ];
    expect(detectDwell(points, 300)).toBeNull();
  });

  it('returns the rest point once it has held for at least DWELL_MS', () => {
    const r = DWELL_RADIUS * 0.6;
    const points: TrailPoint[] = [
      { x: 0.5, y: 0.5, t: 0 },
      { x: 0.5 + r, y: 0.5, t: DWELL_MS / 2 },
      { x: 0.5 + r, y: 0.5 + r, t: DWELL_MS },
    ];
    expect(detectDwell(points, DWELL_MS)).toEqual({ x: 0.5 + r, y: 0.5 + r, since: 0 });
  });

  it('returns null while the rest has held for less than DWELL_MS', () => {
    const r = DWELL_RADIUS * 0.6;
    const now = DWELL_MS - 50;
    const points: TrailPoint[] = [
      { x: 0.5, y: 0.5, t: 0 },
      { x: 0.5 + r, y: 0.5, t: now / 2 },
      { x: 0.5 + r, y: 0.5 + r, t: now },
    ];
    expect(detectDwell(points, now)).toBeNull();
  });

  it('returns null for an empty trail', () => {
    expect(detectDwell([], 1000)).toBeNull();
  });
});

describe('dwellObservation', () => {
  it('observes a learned target under the dwell, re-located on a frame where it moved slightly', () => {
    const el = learnedAt(150, 90);
    const dwellPoint = { x: el.x, y: el.y };
    const movedFrame = frame(2, checkerImage(170, 90));
    const obs = dwellObservation([el], dwellPoint, movedFrame, 555);
    expect(obs).not.toBeNull();
    expect(obs!.name).toBe('Button');
    expect(Math.abs(obs!.x - 170 / W)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(obs!.y - 90 / H)).toBeLessThanOrEqual(0.01);
    expect(obs!.time).toBe(555);
  });

  it('returns null when the dwell is far from any learned target', () => {
    const el = learnedAt(150, 90);
    const obs = dwellObservation([el], { x: 0.9, y: 0.9 }, frame(2, checkerImage(150, 90)), 1);
    expect(obs).toBeNull();
  });

  it('returns null for a target the learner has not observed (timesSeen undefined)', () => {
    const notLearned: FamiliarElement = { id: 'x', name: 'Other', x: 150 / W, y: 90 / H, lastSeen: 1 };
    const obs = dwellObservation([notLearned], { x: 150 / W, y: 90 / H }, frame(2, checkerImage(150, 90)), 1);
    expect(obs).toBeNull();
  });
});

