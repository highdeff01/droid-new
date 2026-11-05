import { describe, expect, it } from 'vitest';
import type { FamiliarElement } from './types.js';
import type { MappedElement } from './element-map-studio.js';
import { STRESS_TEXT, nextSelfTest, selfTestStep, stressReport, stressSteps, stressText, testTargets, type StressResult, type TestTarget } from './self-test.js';

const mapped = (name: string, x: number, y: number, w = 0.1, h = 0.1): MappedElement => ({ id: name, name, box: { x: x - w / 2, y: y - h / 2, w, h }, mappedAt: 0 });
const familiar = (name: string, x: number, y: number): FamiliarElement => ({ id: name, name, x, y, lastSeen: 0 });
const target = (name: string, x = 0.5, y = 0.5): TestTarget => ({ name, x, y });

describe('testTargets', () => {
  it('places mapped elements at their box centre', () => {
    const targets = testTargets([mapped('Save', 0.2, 0.4, 0.2, 0.2)], []);
    expect(targets).toEqual([{ name: 'Save', x: 0.2, y: 0.4 }]);
  });

  it('appends familiar elements not already mapped by name', () => {
    const targets = testTargets([mapped('Save', 0.2, 0.2)], [familiar('Close', 0.8, 0.8)]);
    expect(targets).toEqual([{ name: 'Save', x: 0.2, y: 0.2 }, { name: 'Close', x: 0.8, y: 0.8 }]);
  });

  it('drops a familiar element already mapped under the same name, case-insensitively', () => {
    const targets = testTargets([mapped('Save', 0.2, 0.2)], [familiar('save', 0.9, 0.9), familiar('Close', 0.8, 0.8)]);
    expect(targets.map((t) => t.name)).toEqual(['Save', 'Close']);
  });
});

describe('nextSelfTest', () => {
  it('picks a never-tested target first', () => {
    const targets = [target('A'), target('B')];
    expect(nextSelfTest(targets, { A: 1000 })).toEqual(target('B'));
  });

  it('picks the target tested longest ago when all were tested', () => {
    const targets = [target('A'), target('B'), target('C')];
    expect(nextSelfTest(targets, { A: 300, B: 100, C: 200 })).toEqual(target('B'));
  });

  it('is null when there are no targets', () => {
    expect(nextSelfTest([], {})).toBeNull();
  });
});

describe('selfTestStep', () => {
  it('is a pending click at the target with the target name', () => {
    const step = selfTestStep(target('Save', 0.3, 0.4));
    expect(step).toMatchObject({ action: 'click', target: 'Save', x: 0.3, y: 0.4, status: 'pending' });
    expect(step.name).toContain('Save');
  });
});

describe('stressSteps', () => {
  it('runs click, type, drag for each cycle, typing STRESS_TEXT', () => {
    const steps = stressSteps(target('Save'), 2);
    expect(steps.map((s) => s.action)).toEqual(['click', 'type', 'drag', 'click', 'type', 'drag']);
    expect(steps.filter((s) => s.action === 'type').every((s) => s.text === STRESS_TEXT)).toBe(true);
  });

  it('gives a drag step an endpoint inside 0..1 and the target name as endTarget', () => {
    const [, , drag] = stressSteps(target('Edge', 0.995, 0.995), 1);
    expect(drag.endX).toBeGreaterThanOrEqual(0);
    expect(drag.endX).toBeLessThanOrEqual(1);
    expect(drag.endY).toBeGreaterThanOrEqual(0);
    expect(drag.endY).toBeLessThanOrEqual(1);
    expect(drag.endTarget).toBe('Edge');
  });

  it('runs one cycle when cycles is less than 1', () => {
    const steps = stressSteps(target('Save'), 0);
    expect(steps.map((s) => s.action)).toEqual(['click', 'type', 'drag']);
  });
});

describe('stressReport', () => {
  const results: StressResult[] = [
    { action: 'click', ok: true },
    { action: 'click', ok: false },
    { action: 'type', ok: true },
  ];

  it('counts attempts, successes and reliability, and tallies byAction', () => {
    const r = stressReport('Save', results, false, 10);
    expect(r).toMatchObject({ target: 'Save', time: 10, attempts: 3, succeeded: 2, reliability: 2 / 3, dryRun: false });
    expect(r.byAction).toEqual({ click: { ok: 1, total: 2 }, type: { ok: 1, total: 1 } });
  });

  it('gives a reliability of 0 for no attempts', () => {
    const r = stressReport('Save', [], false);
    expect(r.reliability).toBe(0);
    expect(r.attempts).toBe(0);
  });

  it('carries dryRun through', () => {
    expect(stressReport('Save', results, true).dryRun).toBe(true);
  });
});

describe('stressText', () => {
  it('names the target, the percent reliable and the per-action counts', () => {
    const r = stressReport('Save', [{ action: 'click', ok: true }, { action: 'click', ok: false }], false);
    const text = stressText(r);
    expect(text).toContain('Save');
    expect(text).toContain('50%');
    expect(text).toContain('click 1/2');
  });

  it('mentions dry run only when the report is a dry run', () => {
    const r = stressReport('Save', [{ action: 'click', ok: true }], true);
    expect(stressText(r)).toContain('dry run');
    expect(stressText(stressReport('Save', [{ action: 'click', ok: true }], false))).not.toContain('dry run');
  });
});
