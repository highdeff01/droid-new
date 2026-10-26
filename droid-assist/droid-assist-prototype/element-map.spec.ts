import { describe, expect, it } from 'vitest';
import { buildElementMap, findElement, parseEndpoint, parseMeasureQuery, resolvePath } from './element-map.js';
import { measurePath } from './ruler.js';
import type { Annotation, SavedCard, WorkflowStep } from './types.js';

const annotation = (label: string, extra: Partial<Annotation> = {}): Annotation => ({
  id: `a_${label}`,
  x: 0.1,
  y: 0.1,
  w: 0.1,
  h: 0.1,
  label,
  tone: 'info',
  ...extra,
});

const step = (target: string | undefined, extra: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id: `s_${target ?? 'none'}`,
  name: 'Step',
  action: 'click',
  x: 0.2,
  y: 0.3,
  status: 'pending',
  target,
  ...extra,
});

const card = (id: string, steps: WorkflowStep[]): SavedCard => ({ id, name: id, description: '', savedAt: 0, steps });

describe('buildElementMap', () => {
  it('centers an annotation box when it has no suggested click point', () => {
    const map = buildElementMap([annotation('Files icon', { x: 0.2, y: 0.4, w: 0.1, h: 0.2 })], [], []);
    expect(map).toEqual([{ name: 'Files icon', x: 0.25, y: 0.5, origin: 'annotation' }]);
  });

  it('uses the annotation\'s suggested click point when set', () => {
    const map = buildElementMap([annotation('Files icon', { x: 0.2, y: 0.4, w: 0.1, h: 0.2, actX: 0.28, actY: 0.44 })], [], []);
    expect(map[0]).toMatchObject({ x: 0.28, y: 0.44 });
  });

  it('places a step target at its drift-corrected position, falling back to x/y', () => {
    const corrected = step('Game icon', { x: 0.3, y: 0.4, correctedX: 0.35, correctedY: 0.45 });
    const plain = step('Chat icon', { x: 0.5, y: 0.6 });
    const map = buildElementMap([], [corrected, plain], []);
    expect(map).toEqual([
      { name: 'Game icon', x: 0.35, y: 0.45, origin: 'step' },
      { name: 'Chat icon', x: 0.5, y: 0.6, origin: 'step' },
    ]);
  });

  it('skips steps without a target', () => {
    const map = buildElementMap([], [step(undefined)], []);
    expect(map).toEqual([]);
  });

  it('includes saved-flow targets with origin "flow"', () => {
    const map = buildElementMap([], [], [card('c1', [step('Calendar icon', { x: 0.6, y: 0.7 })])]);
    expect(map).toEqual([{ name: 'Calendar icon', x: 0.6, y: 0.7, origin: 'flow' }]);
  });

  it('dedupes names case-insensitively, keeping the first — annotations win over steps', () => {
    const fromAnnotation = annotation('Files icon', { x: 0.2, y: 0.2, w: 0, h: 0, actX: 0.2, actY: 0.2 });
    const fromStep = step('files icon', { x: 0.9, y: 0.9 });
    const map = buildElementMap([fromAnnotation], [fromStep], []);
    expect(map).toEqual([{ name: 'Files icon', x: 0.2, y: 0.2, origin: 'annotation' }]);
  });
});

describe('findElement', () => {
  const map = buildElementMap([annotation('Files icon', { x: 0.2, y: 0.2, w: 0, h: 0, actX: 0.2, actY: 0.2 })], [], []);

  it('matches a name exactly, case-insensitively', () => {
    expect(findElement('FILES ICON', map)).toMatchObject({ name: 'Files icon' });
  });

  it('matches a shorter query by fuzzy word overlap', () => {
    expect(findElement('files', map)).toMatchObject({ name: 'Files icon' });
  });

  it('returns null for an unknown name', () => {
    expect(findElement('trash can', map)).toBeNull();
  });
});

describe('parseEndpoint', () => {
  it('reads a fraction coordinate as a non-native point', () => {
    expect(parseEndpoint('0.25,0.5')).toEqual({ kind: 'point', x: 0.25, y: 0.5, native: false });
  });

  it('reads a coordinate greater than 1 as a native-pixel point', () => {
    expect(parseEndpoint('480, 270')).toEqual({ kind: 'point', x: 480, y: 270, native: true });
  });

  it.each([
    ['left edge', 'left'],
    ['the right side', 'right'],
    ['top', 'top'],
    ['bottom edge of the screen', 'bottom'],
  ] as const)('reads "%s" as the %s edge', (text, edge) => {
    expect(parseEndpoint(text)).toEqual({ kind: 'edge', edge });
  });

  it('reads anything else as an element name, dropping a leading "the"', () => {
    expect(parseEndpoint('the Files icon')).toEqual({ kind: 'element', name: 'Files icon' });
  });
});

describe('parseMeasureQuery', () => {
  it('splits a chained query into its endpoints', () => {
    const endpoints = parseMeasureQuery('Files icon to Game icon to left edge');
    expect(endpoints).toEqual([
      { kind: 'element', name: 'Files icon' },
      { kind: 'element', name: 'Game icon' },
      { kind: 'edge', edge: 'left' },
    ]);
  });
});

describe('resolvePath', () => {
  const SRC_W = 1920;
  const SRC_H = 1080;
  const map = buildElementMap([annotation('Files icon', { x: 0.2, y: 0.2, w: 0.1, h: 0.6, actX: 0.25, actY: 0.5 })], [], []);

  it('resolves an element then an edge to the perpendicular foot from the element', () => {
    const { points, labels } = resolvePath([{ kind: 'element', name: 'Files icon' }, { kind: 'edge', edge: 'left' }], map, SRC_W, SRC_H);
    expect(points).toEqual([{ x: 0.25, y: 0.5 }, { x: 0, y: 0.5 }]);
    expect(labels).toEqual(['Files icon', 'left edge']);
    expect(measurePath(points, SRC_W, SRC_H).totalPx).toBe(480);
  });

  it('resolves a native-pixel point to a normalized coordinate', () => {
    const { points } = resolvePath([{ kind: 'point', x: 960, y: 540, native: true }, { kind: 'element', name: 'Files icon' }], map, SRC_W, SRC_H);
    expect(points[0]).toEqual({ x: 0.5, y: 0.5 });
  });

  it('anchors a leading edge on the next resolved point', () => {
    const { points, labels } = resolvePath([{ kind: 'edge', edge: 'top' }, { kind: 'element', name: 'Files icon' }], map, SRC_W, SRC_H);
    expect(points).toEqual([{ x: 0.25, y: 0 }, { x: 0.25, y: 0.5 }]);
    expect(labels).toEqual(['top edge', 'Files icon']);
  });

  it('throws naming the unknown element, loudly refusing to invent a coordinate', () => {
    expect(() => resolvePath([{ kind: 'element', name: 'Trash can' }, { kind: 'edge', edge: 'left' }], map, SRC_W, SRC_H)).toThrow(/Trash can.*no coordinate invented/);
  });

  it('throws with fewer than two endpoints', () => {
    expect(() => resolvePath([{ kind: 'element', name: 'Files icon' }], map, SRC_W, SRC_H)).toThrow();
  });

  it('throws when every endpoint is an edge', () => {
    expect(() => resolvePath([{ kind: 'edge', edge: 'left' }, { kind: 'edge', edge: 'top' }], map, SRC_W, SRC_H)).toThrow();
  });
});
