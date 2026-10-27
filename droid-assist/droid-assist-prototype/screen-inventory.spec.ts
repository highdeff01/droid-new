import { describe, expect, it } from 'vitest';
import { buildInventory, classify, findElement, guessKind, inventoryLine, inventoryLines, nameFor, stateCounts, type InventoryElement } from './screen-inventory.js';
import type { Frame } from './types.js';
import type { MappedElement } from './element-map-studio.js';

const W = 320;
const H = 180;
type Rect = [x0: number, x1: number, y0: number, y1: number];

/** A black 320x180 buffer with white rectangles covering sample pixels [x0,x1) x [y0,y1). */
function imageWith(rects: Rect[]): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = rects.some(([x0, x1, y0, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1) ? 255 : 0;
      data.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}

const frameWith = (rects: Rect[], source: Frame['source'] = 'demo'): Frame => ({ id: 1, time: 1, url: 'data:', data: imageWith(rects), srcW: 1920, srcH: 1080, source });

const BUTTON: Rect = [150, 170, 80, 100];
const INPUT: Rect = [40, 140, 120, 130];
const PANEL: Rect = [200, 300, 20, 160];
const TAB: Rect = [20, 60, 0, 10];
const SCREEN = [BUTTON, INPUT, PANEL, TAB];

const byKind = (list: InventoryElement[], kind: InventoryElement['kind']) => list.filter((e) => e.kind === kind);

describe('buildInventory', () => {
  it('returns an empty inventory without a frame', () => {
    expect(buildInventory({ frame: null })).toEqual([]);
  });

  it('extracts every element with its kind, bounds and grid cells', () => {
    const list = buildInventory({ frame: frameWith(SCREEN) });
    expect(list).toHaveLength(4);
    expect(byKind(list, 'panel')).toHaveLength(1);
    expect(byKind(list, 'input')).toHaveLength(1);
    expect(byKind(list, 'tab')).toHaveLength(1);
    const button = byKind(list, 'button')[0];
    expect(button.box.x).toBeCloseTo(150 / 320);
    expect(button.box.y).toBeCloseTo(80 / 180);
    expect(button.box.w).toBeCloseTo(20 / 320);
    expect(button.box.h).toBeCloseTo(20 / 180);
    expect(button.cell).toMatch(/^[A-H]\d{1,2}$/);
    expect(button.mapCells).toMatch(/^R\d+C\d+\.\.R\d+C\d+$/);
    expect(list.every((e) => e.state === 'static')).toBe(true);
  });

  it('does not depend on the capture source', () => {
    const strip = (l: InventoryElement[]) => l.map(({ name, kind, box, state }) => ({ name, kind, box, state }));
    const demo = strip(buildInventory({ frame: frameWith(SCREEN, 'demo') }));
    expect(strip(buildInventory({ frame: frameWith(SCREEN, 'screen') }))).toEqual(demo);
    expect(strip(buildInventory({ frame: frameWith(SCREEN, 'desktop') }))).toEqual(demo);
  });

  it('names elements from mapped and familiar memory, else kind + cell', () => {
    const mapped: MappedElement[] = [{ id: 'm', name: 'Save button', box: { x: 0.46, y: 0.44, w: 0.07, h: 0.12 }, mappedAt: 0 }];
    const familiar = [{ id: 'f', name: 'Search box', x: 0.28, y: 0.69, lastSeen: 0 }];
    const list = buildInventory({ frame: frameWith(SCREEN), mapped, familiar });
    expect(byKind(list, 'button')[0]).toMatchObject({ name: 'Save button', known: true });
    expect(byKind(list, 'input')[0]).toMatchObject({ name: 'Search box', known: true });
    expect(byKind(list, 'panel')[0].name).toMatch(/^panel [A-H]\d+$/);
    expect(byKind(list, 'panel')[0].known).toBe(false);
  });

  it('classifies an element whose pixels changed as in-motion', () => {
    const prevFrame = frameWith([INPUT, PANEL, TAB]);
    const list = buildInventory({ frame: frameWith(SCREEN), prevFrame });
    expect(list.find((e) => e.kind === 'button')?.state).toBe('in-motion');
    expect(list.filter((e) => e.kind !== 'button').every((e) => e.state === 'static')).toBe(true);
  });

  it('classifies a same-named element found elsewhere as moved', () => {
    const mapped = (x: number): MappedElement[] => [{ id: 'm', name: 'OK', box: { x, y: 0.44, w: 0.07, h: 0.12 }, mappedAt: 0 }];
    const prev = buildInventory({ frame: frameWith(SCREEN), mapped: mapped(0.46) });
    const shifted = frameWith([[100, 120, 80, 100], INPUT, PANEL, TAB]);
    const list = buildInventory({ frame: shifted, mapped: mapped(0.31), prev });
    expect(list.find((e) => e.name === 'OK')?.state).toBe('moved');
  });
});

describe('classify', () => {
  const box = { x: 0.5, y: 0.5, w: 0.1, h: 0.1 };
  const frame = frameWith([]);
  const el = (x: number): InventoryElement => ({ id: 'a', name: 'Ok', known: true, kind: 'button', box: { ...box, x }, cell: 'A1', mapCells: '', state: 'static' });
  it('is static within the move threshold and moved beyond it, matching names case-insensitively', () => {
    expect(classify('ok', box, frame, [el(0.51)], null)).toBe('static');
    expect(classify('OK', box, frame, [el(0.53)], null)).toBe('moved');
    expect(classify('Other', box, frame, [el(0.9)], null)).toBe('static');
  });
});

describe('guessKind', () => {
  it('reads shape and position', () => {
    expect(guessKind({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 })).toBe('panel');
    expect(guessKind({ x: 0.1, y: 0.02, w: 0.08, h: 0.05 })).toBe('tab');
    expect(guessKind({ x: 0.1, y: 0.5, w: 0.3, h: 0.05 })).toBe('input');
    expect(guessKind({ x: 0.1, y: 0.5, w: 0.1, h: 0.05 })).toBe('text');
    expect(guessKind({ x: 0.5, y: 0.5, w: 0.05, h: 0.08 })).toBe('button');
  });
});

describe('nameFor / findElement / lines', () => {
  const list = buildInventory({ frame: frameWith(SCREEN), mapped: [{ id: 'm', name: 'Save button', box: { x: 0.46, y: 0.44, w: 0.07, h: 0.12 }, mappedAt: 0 }] });
  it('returns null when nothing remembered overlaps', () => {
    expect(nameFor({ x: 0, y: 0, w: 0.01, h: 0.01 }, [], [])).toBeNull();
  });
  it('finds an element by exact or similar name', () => {
    expect(findElement(list, 'save button')?.kind).toBe('button');
    expect(findElement(list, 'the save button')?.kind).toBe('button');
    expect(findElement(list, 'nothing like it')).toBeNull();
  });
  it('lists named elements first in context lines', () => {
    expect(inventoryLines(list)[0]).toContain('"Save button"');
    expect(inventoryLine(list[0])).toMatch(/^\[Screen element\]/);
    expect(stateCounts(list)).toEqual({ static: 4, moved: 0, 'in-motion': 0 });
  });
});
