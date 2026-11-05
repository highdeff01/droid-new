import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID_OPACITY, drawGrid, type GridCanvas } from './grid-overlay.js';

function canvas() {
  const texts: string[] = [];
  const strokes: string[] = [];
  const fills: string[] = [];
  const ctx = {
    strokeStyle: '', fillStyle: '', lineWidth: 0, font: '',
    beginPath() {}, moveTo() {}, lineTo() {},
    stroke() { strokes.push(String(ctx.strokeStyle)); },
    fillText(t: string) { texts.push(t); fills.push(String(ctx.fillStyle)); },
  };
  return { ctx: ctx as unknown as GridCanvas, texts, strokes, fills };
}

const alpha = (rgba: string) => Number(/,\s*([\d.]+)\)$/.exec(rgba)![1]);

describe('drawGrid', () => {
  it('by default draws only the 12 column numbers and 8 row letters, lines at low alpha', () => {
    const c = canvas();
    drawGrid(c.ctx, 1200, 800, { opacity: DEFAULT_GRID_OPACITY, cellLabels: false });
    expect(c.texts).toHaveLength(20);
    expect(c.texts).toEqual(expect.arrayContaining(['1', '12', 'A', 'H']));
    expect(c.texts).not.toContain('A1');
    expect(c.strokes).toHaveLength(1);
    expect(alpha(c.strokes[0])).toBeLessThan(0.28);
  });

  it('brings back every cell label when asked', () => {
    const c = canvas();
    drawGrid(c.ctx, 1200, 800, { opacity: DEFAULT_GRID_OPACITY, cellLabels: true });
    expect(c.texts).toHaveLength(20 + 96);
    expect(c.texts).toEqual(expect.arrayContaining(['A1', 'H12']));
  });

  it('draws lines at the chosen opacity and never fully opaque labels', () => {
    const c = canvas();
    drawGrid(c.ctx, 1200, 800, { opacity: 0.3, cellLabels: true });
    expect(alpha(c.strokes[0])).toBe(0.3);
    expect(c.fills.every((f) => alpha(f) < 1)).toBe(true);
  });
});
