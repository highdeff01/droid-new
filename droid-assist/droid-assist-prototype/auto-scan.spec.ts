import { describe, expect, it } from 'vitest';
import { classify, scanElements } from './auto-scan.js';

const W = 320;
const H = 180;

/** A black 320x180 buffer with white filled rectangles [x0, y0, x1, y1] in sample pixels. */
function image(rects: Array<[number, number, number, number]>, outline = false): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const edge = x === x0 || x === x1 - 1 || y === y0 || y === y1 - 1;
        if (outline && !edge) continue;
        data.fill(255, (y * W + x) * 4, (y * W + x) * 4 + 3);
      }
    }
  }
  return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}

const TOL = 8 / W;

describe('auto-scan', () => {
  it('finds nothing on a blank frame', () => {
    expect(scanElements(image([]))).toEqual([]);
  });

  it('maps every separate element with a box around it, largest first', () => {
    const found = scanElements(image([[40, 40, 80, 60], [200, 100, 300, 130], [150, 20, 160, 30]]));
    expect(found).toHaveLength(3);
    const [big, mid, small] = found;
    expect(big.box.x).toBeCloseTo(200 / W, 1);
    expect(Math.abs(big.box.x - 200 / W)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(big.box.x + big.box.w - 300 / W)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(big.box.y - 100 / H)).toBeLessThanOrEqual(8 / H);
    expect(Math.abs(mid.box.x - 40 / W)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(mid.box.y + mid.box.h - 60 / H)).toBeLessThanOrEqual(8 / H);
    expect(Math.abs(small.box.x - 150 / W)).toBeLessThanOrEqual(TOL);
    expect(big.box.w * big.box.h).toBeGreaterThan(mid.box.w * mid.box.h);
  });

  it('detects outlined input fields as well as filled shapes', () => {
    const [field] = scanElements(image([[20, 140, 220, 152]], true));
    expect(field.box.w).toBeGreaterThan(0.55);
    expect(field.kind).toMatch(/input|text/);
  });

  it('skips panels larger than a quarter of the screen', () => {
    expect(scanElements(image([[0, 0, 200, 120]]))).toEqual([]);
  });

  it('classifies icons, text, inputs, buttons and other regions by shape and fill', () => {
    expect(classify({ x: 0, y: 0, w: 0.04, h: 0.07 }, { lum: 100, edges: 0.3 })).toBe('icon');
    expect(classify({ x: 0, y: 0, w: 0.4, h: 0.04 }, { lum: 100, edges: 0.3 })).toBe('text');
    expect(classify({ x: 0, y: 0, w: 0.4, h: 0.04 }, { lum: 100, edges: 0.05 })).toBe('input');
    expect(classify({ x: 0, y: 0, w: 0.1, h: 0.06 }, { lum: 100, edges: 0.2 })).toBe('button');
    expect(classify({ x: 0, y: 0, w: 0.3, h: 0.3 }, { lum: 100, edges: 0.2 })).toBe('region');
  });
});
