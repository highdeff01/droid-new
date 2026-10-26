import { describe, expect, it } from 'vitest';
import { FAMILIAR_LIMIT, forgetElement, listElements, rememberElement } from './elements.js';
import type { Annotation, FamiliarElement, Frame, WorkflowStep } from './types.js';

const el = (name: string, x: number, lastSeen: number, patch?: string): FamiliarElement => ({ id: `el-${name}-${lastSeen}`, name, x, y: 0.5, lastSeen, patch });

describe('rememberElement', () => {
  it('adds a new element first', () => {
    const list = rememberElement([el('Files', 0.1, 1)], el('Search', 0.2, 2));
    expect(list.map((e) => e.name)).toEqual(['Search', 'Files']);
  });

  it('updates an element of the same name in place: new point and time, one entry, same id', () => {
    const first = rememberElement([], el('Files icon', 0.1, 1, 'data:image/jpeg;base64,A'));
    const next = rememberElement(first, { ...el('files ICON', 0.3, 5), y: 0.9 });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: first[0].id, x: 0.3, y: 0.9, lastSeen: 5, patch: 'data:image/jpeg;base64,A' });
  });

  it('moves a re-seen element to the front and caps the list', () => {
    let list: FamiliarElement[] = [];
    for (let i = 0; i < FAMILIAR_LIMIT + 5; i++) list = rememberElement(list, el(`e${i}`, 0.1, i));
    expect(list).toHaveLength(FAMILIAR_LIMIT);
    list = rememberElement(list, el('e10', 0.4, 999));
    expect(list[0]).toMatchObject({ name: 'e10', x: 0.4 });
    expect(list.filter((e) => e.name === 'e10')).toHaveLength(1);
  });

  it('ignores a blank name', () => {
    const list = [el('Files', 0.1, 1)];
    expect(rememberElement(list, el('  ', 0.2, 2))).toBe(list);
  });

  it('forgets by id', () => {
    expect(forgetElement([el('A', 0.1, 1), el('B', 0.2, 2)], 'el-A-1').map((e) => e.name)).toEqual(['B']);
  });
});

describe('listElements', () => {
  it('lists template-matched steps, detected popups and familiar elements with coordinates', () => {
    const steps: WorkflowStep[] = [
      { id: 's1', name: 'Click files', action: 'click', target: 'Files icon', x: 0.1, y: 0.2, correctedX: 0.12, correctedY: 0.22, refFrame: {} as Frame, status: 'done' },
      { id: 's2', name: 'Type', action: 'type', x: 0.5, y: 0.5, status: 'pending' },
    ];
    const annotations: Annotation[] = [
      { id: 'a1', x: 0.2, y: 0.2, w: 0.4, h: 0.2, label: 'New popup / UI mismatch', tone: 'error' },
      { id: 'a2', x: 0, y: 0, w: 0.1, h: 0.1, label: 'Just info', tone: 'info' },
    ];
    const out = listElements(steps, annotations, [el('Search', 0.7, 3)]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ name: 'Files icon', x: 0.12, y: 0.22, source: 'template' });
    expect(out[1].source).toBe('popup');
    expect(out[1].x).toBeCloseTo(0.4);
    expect(out[1].y).toBeCloseTo(0.3);
    expect(out[2]).toMatchObject({ name: 'Search', x: 0.7, source: 'familiar', lastSeen: 3 });
  });
});
