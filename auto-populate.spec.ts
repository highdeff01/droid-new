import { describe, expect, it } from 'vitest';
import type { WorkflowStep } from './types.js';
import { SIDE_TEST_COOLDOWN_MS, autoSideTestPlan, correctionFix, interactionKey, noteInteraction, routeTrail, sideTestDue } from './auto-populate.js';

const step = (name: string, over: Partial<WorkflowStep> = {}): WorkflowStep => ({ id: name, name, action: 'click', target: name, x: 0.1, y: 0.2, status: 'pending', ...over });

describe('routeTrail', () => {
  it('chains the executed pointer steps before the step into an element → element path at their corrected points', () => {
    const steps = [step('Menu', { status: 'done', correctedX: 0.11, correctedY: 0.21 }), step('Wait', { action: 'wait', status: 'done' }), step('Skipped', { status: 'failed' }), step('Export', { x: 0.5, y: 0.6 })];
    expect(routeTrail(steps, 3)).toEqual([
      { name: 'Menu', x: 0.11, y: 0.21, via: 'start' },
      { name: 'Export', x: 0.5, y: 0.6, via: 'opens' },
    ]);
  });

  it('keeps only the last six hops', () => {
    const steps = Array.from({ length: 9 }, (_, i) => step(`S${i}`, { status: 'done' }));
    const trail = routeTrail(steps, 8);
    expect(trail.map((h) => h.name)).toEqual(['S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
    expect(trail[0].via).toBe('start');
  });
});

describe('correctionFix', () => {
  it('turns the corrected step into a one-step ai fix script for its context', () => {
    const ctx = { element: 'Save', flow: 'save the file', problem: 'element not found' };
    const fix = correctionFix(ctx, step('Save', { status: 'done', x: 0.4 }));
    expect(fix).toMatchObject({ context: ctx, source: 'ai', reason: 'corrected approach' });
    expect(fix.steps).toHaveLength(1);
    expect(fix.steps[0]).toMatchObject({ action: 'click', target: 'Save', x: 0.4, status: 'pending' });
  });
});

describe('side-test triggers', () => {
  const at = { x: 0.3, y: 0.4 };

  it('counts uses and failures per target, case-insensitively', () => {
    let c = noteInteraction({}, 'Play', at, true);
    c = noteInteraction(c, 'play ', { x: 0.5, y: 0.5 }, false);
    expect(c[interactionKey('PLAY')]).toEqual({ name: 'play', uses: 2, failures: 1, x: 0.5, y: 0.5 });
  });

  it('is due after a failure or three uses, failures first, two at most', () => {
    let c = noteInteraction({}, 'A', at, true);
    c = noteInteraction(c, 'B', at, false);
    for (let i = 0; i < 3; i++) c = noteInteraction(c, 'C', at, true);
    for (let i = 0; i < 4; i++) c = noteInteraction(c, 'D', at, true);
    expect(sideTestDue(c, {}, 1000).map((d) => d.name)).toEqual(['B', 'D']);
  });

  it('rests a side-tested target for ten minutes', () => {
    const c = noteInteraction({}, 'B', at, false);
    expect(sideTestDue(c, { b: 1000 }, 1000 + SIDE_TEST_COOLDOWN_MS - 1)).toEqual([]);
    expect(sideTestDue(c, { b: 1000 }, 1000 + SIDE_TEST_COOLDOWN_MS)).toHaveLength(1);
  });

  it('plans a hover experiment on the main app at the target', () => {
    const plan = autoSideTestPlan({ name: 'Play', uses: 3, failures: 0, x: 0.5, y: 0.62 }, 'background');
    expect(plan).toMatchObject({ target: '', mode: 'background', experiment: { action: 'move', target: 'Play', x: 0.5, y: 0.62 } });
  });
});
