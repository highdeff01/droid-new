import { describe, expect, it } from 'vitest';
import { boxCenter, dragBox, mapCell, mapCells, mapContext, mapElement, mappedAt, toFamiliar, unmapElement, MAP_LIMIT, type MappedElement } from './element-map.js';

const el = (id: string, name: string, box = { x: 0.1, y: 0.2, w: 0.2, h: 0.1 }): MappedElement => ({ id, name, box, mappedAt: 1 });

describe('element map', () => {
  it('turns a drag in any direction into a clamped box and rejects tiny drags', () => {
    expect(dragBox({ x: 0.5, y: 0.6 }, { x: 0.2, y: 0.1 })).toEqual({ x: 0.2, y: 0.1, w: 0.3, h: 0.5 });
    const b = dragBox({ x: -0.2, y: 0.9 }, { x: 0.1, y: 1.4 })!;
    expect(b.x).toBe(0);
    expect(b.y).toBeCloseTo(0.9);
    expect(b.w).toBeCloseTo(0.1);
    expect(b.h).toBeCloseTo(0.1);
    expect(dragBox({ x: 0.3, y: 0.3 }, { x: 0.301, y: 0.5 })).toBeNull();
  });

  it('labels its own 24x16 grid cells, separate from A1..H12', () => {
    expect(mapCell({ x: 0, y: 0 })).toBe('R1C1');
    expect(mapCell({ x: 0.999, y: 0.999 })).toBe('R16C24');
    expect(mapCell({ x: 0.5, y: 0.5 })).toBe('R9C13');
    expect(mapCells({ x: 0, y: 0, w: 0.25, h: 0.25 })).toBe('R1C1..R4C6');
  });

  it('adds newest first, replaces same-name elements, ignores blank names and caps the list', () => {
    let list = mapElement([], el('a', 'OK button'));
    list = mapElement(list, el('b', 'Search'));
    list = mapElement(list, el('c', ' ok BUTTON ', { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }));
    expect(list.map((e) => e.id)).toEqual(['c', 'b']);
    expect(list[0].name).toBe('ok BUTTON');
    expect(mapElement(list, el('d', '   '))).toBe(list);
    expect(unmapElement(list, 'c').map((e) => e.id)).toEqual(['b']);
    let many: MappedElement[] = [];
    for (let i = 0; i < MAP_LIMIT + 5; i++) many = mapElement(many, el(`e${i}`, `n${i}`));
    expect(many).toHaveLength(MAP_LIMIT);
  });

  it('feeds familiar memory with the box centre and the prompt with the boundary', () => {
    const m = el('a', 'Files icon', { x: 0.2, y: 0.4, w: 0.1, h: 0.2 });
    expect(boxCenter(m.box).x).toBeCloseTo(0.25);
    expect(toFamiliar(m, 42)).toMatchObject({ id: 'a', name: 'Files icon', lastSeen: 42 });
    expect(toFamiliar(m, 42).y).toBeCloseTo(0.5);
    const [line] = mapContext([m]);
    expect(line).toContain('"Files icon"');
    expect(line).toContain('x=20.0%..30.0%');
    expect(line).toContain('y=40.0%..60.0%');
    expect(line).toContain('w=0.100,h=0.200');
    expect(line).toContain('map cells R7C5..R10C8');
  });

  it('finds the mapped element under a point', () => {
    const list = [el('a', 'A', { x: 0.1, y: 0.1, w: 0.1, h: 0.1 })];
    expect(mappedAt(list, { x: 0.15, y: 0.15 })?.id).toBe('a');
    expect(mappedAt(list, { x: 0.5, y: 0.5 })).toBeNull();
  });
});
