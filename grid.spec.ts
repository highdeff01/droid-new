import { describe, expect, it } from 'vitest';
import { GRID_PROMPT, cellAt, cellBox, cellLabel, gridRef, parseCell, replyPoint, resolveCell } from './grid.js';
import { AiError } from './ai.js';

describe('grid cells', () => {
  it('labels rows A..H top to bottom and columns 1..12 left to right', () => {
    expect(cellLabel({ row: 0, col: 0 })).toBe('A1');
    expect(cellLabel({ row: 7, col: 11 })).toBe('H12');
    expect(cellLabel({ row: 2, col: 4 })).toBe('C5');
  });

  it('parses valid references case-insensitively and rejects anything off the grid', () => {
    expect(parseCell('C5')).toEqual({ row: 2, col: 4 });
    expect(parseCell(' c5 ')).toEqual({ row: 2, col: 4 });
    expect(parseCell('H12')).toEqual({ row: 7, col: 11 });
    for (const bad of ['I1', 'A13', 'A0', '5C', '', 'C', 42, null, undefined]) expect(parseCell(bad)).toBeNull();
  });

  it('gives each cell a twelfth of the width and an eighth of the height', () => {
    expect(cellBox({ row: 2, col: 4 })).toEqual({ x: 4 / 12, y: 2 / 8, w: 1 / 12, h: 1 / 8 });
  });
});

describe('resolveCell', () => {
  it('resolves cell centres by default', () => {
    expect(resolveCell('A1')).toEqual({ x: 1 / 24, y: 1 / 16 });
    const h12 = resolveCell('H12', 0.5, 0.5)!;
    expect(h12.x).toBeCloseTo(23 / 24);
    expect(h12.y).toBeCloseTo(15 / 16);
  });

  it('measures the in-cell fraction from the cell top-left to its far edge', () => {
    expect(resolveCell('C5', 0, 0)).toEqual({ x: 4 / 12, y: 2 / 8 });
    const far = resolveCell('C5', 1, 1)!;
    expect(far.x).toBeCloseTo(5 / 12);
    expect(far.y).toBeCloseTo(3 / 8);
  });

  it('clamps out-of-range fractions into the cell and centres non-numeric ones', () => {
    const p = resolveCell('C5', 1.5, -1)!;
    expect(p.x).toBeCloseTo(5 / 12);
    expect(p.y).toBeCloseTo(2 / 8);
    expect(resolveCell('C5', Number.NaN, '0.25')).toEqual({ x: 4.5 / 12, y: 2.25 / 8 });
  });

  it('returns null for an invalid cell', () => {
    expect(resolveCell('A13', 0.5, 0.5)).toBeNull();
  });
});

describe('cellAt / gridRef', () => {
  it('finds the containing cell, clamping edge points onto the grid', () => {
    expect(cellAt({ x: 0.06, y: 0.35 })).toEqual({ row: 2, col: 0 });
    expect(cellAt({ x: 1, y: 1 })).toEqual({ row: 7, col: 11 });
  });

  it('round-trips with resolveCell', () => {
    expect(gridRef({ x: 4.25 / 12, y: 2.8 / 8 })).toBe('C5 (0.25, 0.80)');
  });
});

describe('replyPoint', () => {
  it('prefers cell + in-cell fraction', () => {
    const p = replyPoint({ cell: 'B3', cx: 0.5, cy: 0.5, x: 0.9, y: 0.9 });
    expect(p.x).toBeCloseTo(2.5 / 12);
    expect(p.y).toBeCloseTo(1.5 / 8);
  });

  it('falls back to the legacy global x/y when the cell is missing or invalid', () => {
    expect(replyPoint({ x: 0.4, y: 0.6 })).toEqual({ x: 0.4, y: 0.6 });
    expect(replyPoint({ cell: 'Z9', x: 240, y: 135 })).toEqual({ x: 0.5, y: 0.5 });
  });

  it('uses the fallback point, and fails without any point', () => {
    expect(replyPoint({}, { x: 0.3, y: 0.7 })).toEqual({ x: 0.3, y: 0.7 });
    expect(() => replyPoint({})).toThrow(AiError);
  });
});

describe('GRID_PROMPT', () => {
  it('defines the cell labels and their coordinate ranges', () => {
    expect(GRID_PROMPT).toContain('"A1"');
    expect(GRID_PROMPT).toContain('"H12"');
    expect(GRID_PROMPT).toContain('1=0.000..0.083 (0-40px)');
    expect(GRID_PROMPT).toContain('H=0.875..1.000');
  });
});
