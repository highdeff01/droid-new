import { describe, expect, it } from 'vitest';
import type { Detection } from './auto-scan.js';
import { MAP_LIMIT, type MappedElement, type MoveCause, type MoveEvent } from './element-map-studio.js';
import { MOVE_BLAME_MS, POSITION_LIMIT, SETTLE_MS, capMap, catchPlan, countHere, ghostPositions, mergeScan, motionOf, motionTiming, moveCause, notePosition, trackingContext, trackingLine } from './element-tracking.js';

const box = (x: number, y: number, w = 0.1, h = 0.06) => ({ x, y, w, h });
const det = (b = box(0.1, 0.1), kind: Detection['kind'] = 'button'): Detection => ({ box: b, kind, appearance: { lum: 100, edges: 0.2 } });
let n = 0;
const newId = () => `auto${++n}`;
const mv = (time: number, cause: MoveCause): MoveEvent => ({ time, cause, from: box(0.1, 0.1), to: box(0.2, 0.1) });
const moving = (moves: MoveEvent[], extra: Partial<MappedElement> = {}): MappedElement => ({ id: 'm', name: 'Ball', box: box(0.2, 0.1), mappedAt: 0, moves, positions: [{ box: box(0.1, 0.1), count: 4, firstSeen: 0, lastSeen: 1 }, { box: box(0.2, 0.1), count: 2, firstSeen: 1, lastSeen: 2 }], ...extra });

describe('element tracking: auto-mapping merge', () => {
  it('maps every new detection as an auto element with a unique grid name', () => {
    const r = mergeScan([], [det(box(0.126, 0.1, 0.01, 0.01)), det(box(0.14, 0.1, 0.01, 0.01)), det(box(0.6, 0.6), 'icon')], 10, [], newId);
    expect(r.added).toBe(3);
    expect(r.map.every((e) => e.origin === 'auto' && e.timesSeen === 1)).toBe(true);
    expect(r.map.map((e) => e.name)).toEqual(['button at R2C4', 'button at R2C4 #2', 'icon at R11C16']);
    expect(r.map[0].positions).toEqual([{ box: box(0.126, 0.1, 0.01, 0.01), count: 1, firstSeen: 10, lastSeen: 10 }]);
  });

  it('counts a sighting at the same spot instead of adding a duplicate', () => {
    const first = mergeScan([], [det()], 10, [], newId).map;
    const r = mergeScan(first, [det(box(0.101, 0.1))], 20, [], newId);
    expect(r).toMatchObject({ added: 0, seen: 1 });
    expect(r.map).toHaveLength(1);
    expect(r.map[0].timesSeen).toBe(2);
    expect(r.map[0].positions?.[0].count).toBe(2);
    expect(countHere(r.map[0])).toBe(2);
  });

  it('merges with user-drawn elements, keeping their names', () => {
    const user: MappedElement = { id: 'u', name: 'OK button', box: box(0.1, 0.1), mappedAt: 1 };
    const r = mergeScan([user], [det()], 5, [], newId);
    expect(r.map).toHaveLength(1);
    expect(r.map[0]).toMatchObject({ id: 'u', name: 'OK button', timesSeen: 1, kind: 'button' });
    expect(r.map[0].origin).toBeUndefined();
  });

  it('follows a moved element and keeps its old spot as a ghost with its count', () => {
    let map = mergeScan([], [det()], 10, [], newId).map;
    map = mergeScan(map, [det()], 20, [], newId).map;
    const r = mergeScan(map, [det(box(0.2, 0.1))], 30, [], newId);
    expect(r.added).toBe(0);
    expect(r.moved).toHaveLength(1);
    const el = r.map[0];
    expect(el.box).toEqual(box(0.2, 0.1));
    expect(countHere(el)).toBe(1);
    expect(ghostPositions(el)).toEqual([{ box: box(0.1, 0.1), count: 2, firstSeen: 10, lastSeen: 20 }]);
    expect(el.moves).toEqual([{ time: 30, cause: 'self', from: box(0.1, 0.1), to: box(0.2, 0.1) }]);
  });

  it('does not treat a different-looking or far element as moved', () => {
    const map = mergeScan([], [det()], 10, [], newId).map;
    expect(mergeScan(map, [det(box(0.7, 0.7))], 20, [], newId).added).toBe(1);
    expect(mergeScan(map, [det(box(0.2, 0.1), 'icon')], 20, [], newId).added).toBe(1);
  });

  it('blames a move on the latest user or AI input at the old or new spot, else on the element itself', () => {
    const from = box(0.1, 0.1);
    const to = box(0.5, 0.5);
    expect(moveCause(from, to, 5000, [{ time: 4000, x: 0.15, y: 0.13, actor: 'user' }])).toBe('user');
    expect(moveCause(from, to, 5000, [{ time: 3000, x: 0.15, y: 0.13, actor: 'user' }, { time: 4500, x: 0.55, y: 0.53, actor: 'ai' }])).toBe('ai');
    expect(moveCause(from, to, 5000, [{ time: 5000 - MOVE_BLAME_MS - 1, x: 0.15, y: 0.13, actor: 'user' }])).toBe('self');
    expect(moveCause(from, to, 5000, [{ time: 5100, x: 0.15, y: 0.13, actor: 'user' }])).toBe('self');
    expect(moveCause(from, to, 5000, [{ time: 4900, x: 0.9, y: 0.9, actor: 'ai' }])).toBe('self');
  });

  it('caps positions by dropping the least-seen one', () => {
    const start = Array.from({ length: POSITION_LIMIT }, (_, i) => ({ box: box(i * 0.11, 0.5, 0.05, 0.05), count: i === 3 ? 1 : 2, firstSeen: 0, lastSeen: 0 }));
    const next = notePosition(start, box(0.5, 0.9, 0.05, 0.05), 9);
    expect(next).toHaveLength(POSITION_LIMIT);
    expect(next.some((p) => p.box.x === 3 * 0.11)).toBe(false);
    expect(next[next.length - 1]).toEqual({ box: box(0.5, 0.9, 0.05, 0.05), count: 1, firstSeen: 9, lastSeen: 9 });
  });

  it('keeps user elements and drops the auto elements seen longest ago past the map limit', () => {
    const user: MappedElement = { id: 'u', name: 'Mine', box: box(0, 0), mappedAt: 0 };
    const autos: MappedElement[] = Array.from({ length: MAP_LIMIT }, (_, i) => ({ id: `a${i}`, name: `a${i}`, box: box(0, 0), mappedAt: 0, origin: 'auto', lastSeen: i }));
    const kept = capMap([user, ...autos]);
    expect(kept).toHaveLength(MAP_LIMIT);
    expect(kept.some((e) => e.id === 'u')).toBe(true);
    expect(kept.some((e) => e.id === 'a0')).toBe(false);
  });
});

describe('element tracking: motion classification and timing', () => {
  it('labels static, moved by user/AI and always-in-motion elements', () => {
    expect(motionOf(moving([]))).toEqual({ kind: 'static', user: 0, ai: 0, self: 0 });
    expect(motionOf(moving([mv(1, 'user'), mv(2, 'ai')])).kind).toBe('moved');
    expect(motionOf(moving([mv(1, 'self'), mv(2, 'self')])).kind).toBe('moved');
    expect(motionOf(moving([mv(1, 'self'), mv(2, 'self'), mv(3, 'self')]))).toEqual({ kind: 'in_motion', user: 0, ai: 0, self: 3 });
    expect(motionOf(moving([mv(1, 'self'), mv(2, 'self'), mv(3, 'self'), ...[4, 5, 6, 7].map((t) => mv(t, 'user'))])).kind).toBe('moved');
  });

  it('measures the intervals between its own moves and predicts the next', () => {
    expect(motionTiming(moving([mv(1000, 'self')]))).toBeNull();
    const t = motionTiming(moving([mv(1000, 'self'), mv(1500, 'user'), mv(2000, 'self'), mv(3200, 'self')]))!;
    expect(t.intervals).toEqual([1000, 1200]);
    expect(t.meanMs).toBe(1100);
    expect(t.jitterMs).toBe(100);
    expect(t.lastMoveAt).toBe(3200);
    expect(t.nextAt).toBe(4300);
  });

  it('schedules catching a moving element: now early in its rest, after the next move late in it', () => {
    expect(catchPlan(null, 5).waitMs).toBe(0);
    const timing = { intervals: [1000], meanMs: 1000, jitterMs: 0, lastMoveAt: 0, nextAt: 1000 };
    expect(catchPlan(timing, 200).waitMs).toBe(0);
    expect(catchPlan(timing, 2200).waitMs).toBe(0);
    expect(catchPlan(timing, 800).waitMs).toBe(1000 - 800 + SETTLE_MS);
  });

  it('describes moved elements for the AI with ghosts, counts and timing', () => {
    const still: MappedElement = { id: 's', name: 'Logo', box: box(0, 0), mappedAt: 0 };
    expect(trackingLine(still)).toBeNull();
    expect(trackingLine({ ...still, perform: { kind: 'click', source: 'user' } })).toContain('perform: click');
    const line = trackingLine(moving([mv(1000, 'self'), mv(2000, 'self'), mv(3000, 'self')]))!;
    expect(line).toContain('"Ball" in motion');
    expect(line).toContain('seen 2×');
    expect(line).toContain('was at');
    expect(line).toContain('4×');
    expect(line).toContain('self 3');
    expect(line).toContain('moves every ~1000 ms');
    expect(trackingContext([still, moving([mv(1, 'user')])])).toHaveLength(1);
  });
});
