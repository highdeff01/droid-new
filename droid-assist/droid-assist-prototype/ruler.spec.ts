import { describe, expect, it } from 'vitest';
import { describeMeasurement, measurePath } from './ruler.js';

const W = 1920;
const H = 1080;

describe('measurePath', () => {
  it('measures a diagonal segment in pixels, percent of diagonal, and signed dx/dy', () => {
    const m = measurePath([{ x: 0, y: 0 }, { x: 1, y: 1 }], W, H);
    const [s] = m.segments;
    expect(s.px).toBe(2203);
    expect(s.pct).toBe(100);
    expect(s.dxPx).toBe(1920);
    expect(s.dyPx).toBe(1080);
    expect(s.dxPct).toBe(100);
    expect(s.dyPct).toBe(100);
  });

  it('measures a vertical segment in native pixels, not a scaled-down resolution', () => {
    const m = measurePath([{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }], W, H);
    expect(m.segments[0].px).toBe(1080);
  });

  it('gives negative dx/dy for a segment that moves left and up', () => {
    const m = measurePath([{ x: 1, y: 1 }, { x: 0, y: 0 }], W, H);
    const [s] = m.segments;
    expect(s.dxPx).toBeLessThan(0);
    expect(s.dyPx).toBeLessThan(0);
    expect(s.dxPct).toBeLessThan(0);
    expect(s.dyPct).toBeLessThan(0);
  });

  it('measures each segment and the total of a 3-point polyline', () => {
    const m = measurePath([{ x: 0, y: 0 }, { x: 0.25, y: 0 }, { x: 0.25, y: 0.5 }], W, H);
    expect(m.segments[0].px).toBe(480);
    expect(m.segments[1].px).toBe(540);
    expect(m.totalPx).toBe(1020);
  });

  it('has no segments and a zero total for a single point', () => {
    const m = measurePath([{ x: 0.3, y: 0.4 }], W, H);
    expect(m.segments).toHaveLength(0);
    expect(m.totalPx).toBe(0);
    expect(m.totalPct).toBe(0);
  });

  it('has no segments and a zero total for zero points', () => {
    const m = measurePath([], W, H);
    expect(m.segments).toHaveLength(0);
    expect(m.totalPx).toBe(0);
    expect(m.totalPct).toBe(0);
  });
});

describe('describeMeasurement', () => {
  it("reports the total and each segment's pixel and percent length, joined by the point labels", () => {
    const m = measurePath([{ x: 0, y: 0 }, { x: 0.25, y: 0 }, { x: 0.25, y: 0.5 }], W, H);
    const line = describeMeasurement(m, ['Files icon', 'Game icon', 'Dock edge']);
    expect(line).toContain('Files icon → Game icon → Dock edge');
    expect(line).toContain('total');
    expect(line).toContain(`${m.totalPx}px`);
    expect(line).toContain('% of screen');
  });

  it('asks for another point when only one has been placed', () => {
    const m = measurePath([{ x: 0.3, y: 0.4 }], W, H);
    expect(describeMeasurement(m)).toContain('add another point');
  });
});
