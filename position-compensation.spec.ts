import { describe, expect, it } from 'vitest';
import type { WorkflowStep } from './types.js';
import { CATCH_MAX_MS, catchWait, compensate, seedPoint, systematicOffset } from './position-compensation.js';
import { findDossier, recordObservation, recordOutcome, recordTest, setPreferred, type PositionDossier } from './position-dossier.js';

const step = { id: 's1', name: 'Click save', action: 'click', target: 'Save', x: 0.5, y: 0.5, status: 'pending' } as WorkflowStep;
const base = () => recordObservation([], { name: 'Save', x: 0.5, y: 0.5, time: 0, by: 'user' });
const one = (list: PositionDossier[]) => findDossier(list, 'Save')!;
const tested = (deltas: [number, number][]) => deltas.reduce((l, [dx, dy], i) => recordTest(l, 'Save', { x: 0.5, y: 0.5 }, { x: 0.5 + dx, y: 0.5 + dy }, i), base());

describe('systematicOffset', () => {
  it('measures a consistent offset over at least three tests', () => {
    const o = systematicOffset(one(tested([[0.02, 0.01], [0.021, 0.01], [0.019, 0.011]])).tests)!;
    expect(o.x).toBeCloseTo(0.02, 3);
    expect(o.y).toBeCloseTo(0.0103, 3);
  });

  it('needs three tests, a large enough mean and a tight spread', () => {
    expect(systematicOffset(one(tested([[0.02, 0], [0.02, 0]])).tests)).toBeNull();
    expect(systematicOffset(one(tested([[0.001, 0], [0.001, 0], [0.001, 0]])).tests)).toBeNull();
    expect(systematicOffset(one(tested([[0.05, 0], [-0.04, 0], [0.02, 0.03]])).tests)).toBeNull();
  });
});

describe('compensate', () => {
  it('leaves the point alone without a dossier', () => {
    expect(compensate(null, step, { x: 0.5, y: 0.5 }, new Set(), 0)).toEqual({ point: { x: 0.5, y: 0.5 }, waitMs: 0, offset: null, notes: [] });
  });

  it('applies a systematic offset once per step', () => {
    const d = one(tested([[0.02, 0], [0.02, 0], [0.02, 0]]));
    const first = compensate(d, step, { x: 0.5, y: 0.5 }, new Set(), 0);
    expect(first.point.x).toBeCloseTo(0.52, 5);
    expect(first.offset).not.toBeNull();
    const again = compensate(d, step, { x: 0.5, y: 0.5 }, new Set(['s1']), 0);
    expect(again.point).toEqual({ x: 0.5, y: 0.5 });
    expect(again.offset).toBeNull();
  });

  it('prefers a preferred position over the best one', () => {
    let list = base();
    list = recordOutcome(list, 'Save', { x: 0.8, y: 0.8 }, true, 1);
    list = recordOutcome(list, 'Save', { x: 0.8, y: 0.8 }, true, 2);
    expect(compensate(one(list), step, { x: 0.5, y: 0.5 }, new Set(), 0).point).toMatchObject({ x: 0.8, y: 0.8 });
    list = setPreferred(list, 'Save', { x: 0.1, y: 0.2, by: 'user' });
    expect(compensate(one(list), step, { x: 0.5, y: 0.5 }, new Set(), 0).point).toMatchObject({ x: 0.1, y: 0.2 });
  });

  it('keeps a planned point already within 3% of the best position', () => {
    let list = recordOutcome(base(), 'Save', { x: 0.51, y: 0.5 }, true, 1);
    list = recordOutcome(list, 'Save', { x: 0.51, y: 0.5 }, true, 2);
    expect(compensate(one(list), step, { x: 0.5, y: 0.5 }, new Set(), 0).point).toEqual({ x: 0.5, y: 0.5 });
  });

  it('waits to catch an in-motion element and aims at its next position', () => {
    let list: PositionDossier[] = [];
    [[0.1, 0.1], [0.5, 0.5], [0.1, 0.1], [0.5, 0.5], [0.1, 0.1]].forEach(([x, y], i) => (list = recordObservation(list, { name: 'Save', x, y, time: i * 1000, by: 'user' })));
    const out = compensate(one(list), step, { x: 0.1, y: 0.1 }, new Set(), 4400);
    expect(out.point).toMatchObject({ x: 0.5, y: 0.5 });
    expect(out.waitMs).toBe(600);
    expect(catchWait(one(list), 100000)).toBe(0);
    expect(CATCH_MAX_MS).toBe(5000);
  });

  it('seeds drift search from the last-known position', () => {
    expect(seedPoint(one(base()))).toMatchObject({ x: 0.5, y: 0.5 });
    expect(seedPoint(null)).toBeNull();
  });
});
