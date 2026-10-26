import { describe, expect, it } from 'vitest';
import type { Frame } from './types.js';
import { checkMoved, findPatch, relationHolds, sameElement, verifyArrangement, type Expectation, type MovedElement } from './rearrange.js';

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

const W = 320;
const H = 180;

type Point = { x: number; y: number };

/** A 320x180 frame with a dark background (~40) and a bright 12x12 square (220) centred at each normalized point. */
function squareFrame(points: Point[]): Frame {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inSquare = points.some((p) => Math.abs(x - Math.round(p.x * W)) < 6 && Math.abs(y - Math.round(p.y * H)) < 6);
      const v = inSquare ? 220 : 40;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { id: 0, time: 0, url: 'data:,', data: new ImageData(data, W, H), srcW: 1920, srcH: 1080, source: 'demo' };
}

describe('rearrange', () => {
  describe('findPatch', () => {
    it('finds a moved square near its new spot', () => {
      const from = { x: 0.3, y: 0.3 };
      const to = { x: 0.3, y: 0.6 };
      const ref = squareFrame([from]).data;
      const live = squareFrame([to]).data;
      const hit = findPatch(ref, from, live, to);
      expect(hit).not.toBeNull();
      expect(Math.hypot(hit!.at.x - to.x, hit!.at.y - to.y)).toBeLessThanOrEqual(0.02);
    });

    it('returns null when the square is absent near the given point', () => {
      const from = { x: 0.3, y: 0.3 };
      const ref = squareFrame([from]).data;
      const live = squareFrame([]).data;
      expect(findPatch(ref, from, live, from)).toBeNull();
    });
  });

  describe('checkMoved', () => {
    it('reports moved when the square lands within tolerance of the drop point', () => {
      const from = { x: 0.2, y: 0.2 };
      const to = { x: 0.6, y: 0.6 };
      const before = squareFrame([from]);
      const after = squareFrame([to]);
      const el: MovedElement = { name: 'Files', from, to, before };
      const result = checkMoved(el, after, null);
      expect(result.moved).toBe(true);
    });

    it('reports not moved when the square never left its start', () => {
      const from = { x: 0.2, y: 0.2 };
      const to = { x: 0.6, y: 0.6 };
      const before = squareFrame([from]);
      const after = squareFrame([from]);
      const el: MovedElement = { name: 'Files', from, to, before };
      const result = checkMoved(el, after, null);
      expect(result.moved).toBe(false);
      expect(result.detail).toContain('still at the start');
    });

    it('reports not moved when the square lands away from the drop point', () => {
      const from = { x: 0.2, y: 0.2 };
      const to = { x: 0.6, y: 0.6 };
      const landed = { x: 0.66, y: 0.6 };
      const before = squareFrame([from]);
      const after = squareFrame([landed]);
      const el: MovedElement = { name: 'Files', from, to, before };
      const result = checkMoved(el, after, null);
      expect(result.moved).toBe(false);
      expect(result.detail).toContain('away from the drop point');
    });

    it('cannot confirm the move with neither a frame nor the element map', () => {
      const el: MovedElement = { name: 'Files', from: { x: 0.2, y: 0.2 }, to: { x: 0.6, y: 0.6 }, before: null };
      const result = checkMoved(el, null, null);
      expect(result.moved).toBe(false);
      expect(result.detail).toContain('cannot confirm');
    });

    it('trusts the element map when there are no frames', () => {
      const to = { x: 0.6, y: 0.6 };
      const el: MovedElement = { name: 'Files', from: { x: 0.2, y: 0.2 }, to, before: null };
      const result = checkMoved(el, null, to);
      expect(result.moved).toBe(true);
    });

    it('reports not moved when the template and element map disagree', () => {
      const from = { x: 0.2, y: 0.2 };
      const to = { x: 0.6, y: 0.6 };
      const before = squareFrame([from]);
      const after = squareFrame([to]);
      const mapped = { x: to.x + 0.2, y: to.y };
      const el: MovedElement = { name: 'Files', from, to, before };
      const result = checkMoved(el, after, mapped);
      expect(result.moved).toBe(false);
      expect(result.detail).toContain('disagree');
    });
  });

  describe('relationHolds', () => {
    const anchor = { x: 0.5, y: 0.5 };

    it('below holds in the same column with enough gap', () => {
      expect(relationHolds('below', { x: 0.5, y: 0.6 }, anchor)).toBe(true);
    });

    it('below fails in a different column', () => {
      expect(relationHolds('below', { x: 0.7, y: 0.6 }, anchor)).toBe(false);
    });

    it('above holds in the same column with enough gap', () => {
      expect(relationHolds('above', { x: 0.5, y: 0.4 }, anchor)).toBe(true);
    });

    it('above fails in a different column', () => {
      expect(relationHolds('above', { x: 0.7, y: 0.4 }, anchor)).toBe(false);
    });

    it('right_of holds in the same row with enough gap', () => {
      expect(relationHolds('right_of', { x: 0.6, y: 0.5 }, anchor)).toBe(true);
    });

    it('right_of fails in a different row', () => {
      expect(relationHolds('right_of', { x: 0.6, y: 0.7 }, anchor)).toBe(false);
    });

    it('left_of holds in the same row with enough gap', () => {
      expect(relationHolds('left_of', { x: 0.4, y: 0.5 }, anchor)).toBe(true);
    });

    it('left_of fails in a different row', () => {
      expect(relationHolds('left_of', { x: 0.4, y: 0.7 }, anchor)).toBe(false);
    });
  });

  describe('sameElement', () => {
    it('matches a name against its icon phrasing', () => {
      expect(sameElement('Files icon', 'files')).toBe(true);
    });

    it('does not match unrelated names', () => {
      expect(sameElement('Files', 'Notes')).toBe(false);
    });
  });

  describe('verifyArrangement', () => {
    const chain: Expectation[] = [
      { element: 'Game', relation: 'below', anchor: 'Calc' },
      { element: 'Notes', relation: 'below', anchor: 'Game' },
      { element: 'Files', relation: 'below', anchor: 'Notes' },
    ];

    function mappedOnly(positions: Record<string, Point>): MovedElement[] {
      return Object.entries(positions).map(([name, to]) => ({ name, from: to, to, before: null }));
    }

    it('passes every element when the chained order holds', () => {
      const positions: Record<string, Point> = { Calc: { x: 0.5, y: 0.2 }, Game: { x: 0.5, y: 0.4 }, Notes: { x: 0.5, y: 0.6 }, Files: { x: 0.5, y: 0.8 } };
      const verdicts = verifyArrangement(mappedOnly(positions), chain, null, (name) => positions[name] ?? null);
      expect(verdicts.every((v) => v.pass)).toBe(true);
    });

    it('fails the element that is out of order', () => {
      const positions: Record<string, Point> = { Calc: { x: 0.5, y: 0.2 }, Game: { x: 0.5, y: 0.4 }, Notes: { x: 0.5, y: 0.1 }, Files: { x: 0.5, y: 0.8 } };
      const verdicts = verifyArrangement(mappedOnly(positions), chain, null, (name) => positions[name] ?? null);
      const notes = verdicts.find((v) => v.element === 'Notes')!;
      expect(notes.pass).toBe(false);
      expect(notes.detail).toContain('not below');
    });

    it('fails when an anchor is not located', () => {
      const positions: Record<string, Point> = { Game: { x: 0.5, y: 0.4 }, Notes: { x: 0.5, y: 0.6 }, Files: { x: 0.5, y: 0.8 } };
      const verdicts = verifyArrangement(mappedOnly(positions), chain, null, (name) => positions[name] ?? null);
      const game = verdicts.find((v) => v.element === 'Game')!;
      expect(game.pass).toBe(false);
      expect(game.detail).toContain('anchor "Calc" not located');
    });

    it('passes an unexpected-relation moved element found at its drop point', () => {
      const from = { x: 0.2, y: 0.2 };
      const to = { x: 0.6, y: 0.6 };
      const el: MovedElement = { name: 'Files', from, to, before: squareFrame([from]) };
      const verdicts = verifyArrangement([el], [], squareFrame([to]), () => null);
      expect(verdicts[0].pass).toBe(true);
      expect(verdicts[0].detail).toContain('at its drop point');
    });

    it('fails an unexpected-relation moved element found away from its drop point', () => {
      const from = { x: 0.2, y: 0.2 };
      const to = { x: 0.6, y: 0.6 };
      const landed = { x: 0.66, y: 0.6 };
      const el: MovedElement = { name: 'Files', from, to, before: squareFrame([from]) };
      const verdicts = verifyArrangement([el], [], squareFrame([landed]), () => null);
      expect(verdicts[0].pass).toBe(false);
      expect(verdicts[0].detail).toContain('not at its drop point');
    });

    it('orders moved elements before unmoved expectation elements', () => {
      const from = { x: 0.3, y: 0.3 };
      const to = { x: 0.5, y: 0.5 };
      const el: MovedElement = { name: 'Files', from, to, before: squareFrame([from]) };
      const expectation: Expectation[] = [{ element: 'Notes', relation: 'below', anchor: 'Files' }];
      const verdicts = verifyArrangement([el], expectation, squareFrame([to]), () => null);
      expect(verdicts.map((v) => v.element)).toEqual(['Files', 'Notes']);
    });

    it('carries the moved element before frame in its verdict', () => {
      const from = { x: 0.3, y: 0.3 };
      const to = { x: 0.5, y: 0.5 };
      const before = squareFrame([from]);
      const el: MovedElement = { name: 'Files', from, to, before };
      const verdicts = verifyArrangement([el], [], squareFrame([to]), () => null);
      expect(verdicts[0].before).toBe(before);
    });
  });
});
