import { describe, expect, it } from 'vitest';
import { REPLAN_CAP, createPlanGuard, planSignature } from './plan-guard.js';
import type { WorkflowStep } from './types.js';

const step = (x: number, target = 'files icon'): WorkflowStep => ({ id: `s${x}`, name: 'Hover', action: 'move', target, x, y: 0.9, status: 'pending' });

describe('planSignature', () => {
  it('ignores ids and status but not action, target or position', () => {
    expect(planSignature([{ ...step(0.1), id: 'other', status: 'done' }])).toBe(planSignature([step(0.1)]));
    expect(planSignature([step(0.1)])).not.toBe(planSignature([step(0.3)]));
    expect(planSignature([step(0.1)])).not.toBe(planSignature([step(0.1, 'trash')]));
  });
});

describe('createPlanGuard', () => {
  it('defaults to 3 re-plans per goal', () => {
    expect(REPLAN_CAP).toBe(3);
  });

  it('allows the first plan plus 3 re-plans on an unchanged screen, then trips once', () => {
    const guard = createPlanGuard();
    for (let i = 0; i < 4; i++) {
      expect(guard.before('open files', 'f1:0')).toEqual({ run: true });
      expect(guard.after([step(i / 10)])).toBe('fresh');
    }
    const tripped = guard.before('open files', 'f1:0');
    expect(tripped.run).toBe(false);
    expect(!tripped.run && tripped.log).toMatch(/cap/);
    expect(guard.before('open files', 'f1:0')).toEqual({ run: false, log: null });
  });

  it('treats a goal differing only in case or spacing as the same goal', () => {
    const guard = createPlanGuard(0);
    expect(guard.before('Open Files', 's').run).toBe(true);
    expect(guard.before('  open files ', 's').run).toBe(false);
  });

  it('resets when the screen state or the goal changes', () => {
    const guard = createPlanGuard(0);
    expect(guard.before('g', 'f1:0').run).toBe(true);
    expect(guard.before('g', 'f1:0').run).toBe(false);
    expect(guard.before('g', 'f2:0').run).toBe(true);
    expect(guard.before('g', 'f2:1').run).toBe(true);
    expect(guard.before('other', 'f2:1').run).toBe(true);
  });

  it('keeps each goal\'s cap and dedupe when goals are interleaved', () => {
    const guard = createPlanGuard();
    let runsA = 0;
    let runsB = 0;
    for (let i = 0; i < 10; i++) {
      if (guard.before('A', 's').run) {
        runsA++;
        guard.after([step(i / 20)]);
      }
      if (guard.before('B', 's').run) {
        runsB++;
        guard.after([step(0.5, 'trash')]);
      }
    }
    expect(runsA).toBe(4);
    expect(runsB).toBe(2);
  });

  it('marks an identical consecutive plan as a duplicate and skips the model silently after it', () => {
    const guard = createPlanGuard();
    guard.before('g', 's');
    expect(guard.after([step(0.1)])).toBe('fresh');
    guard.before('g', 's');
    expect(guard.after([step(0.1)])).toBe('duplicate');
    expect(guard.before('g', 's')).toEqual({ run: false, log: null });
    expect(guard.before('g', 'changed').run).toBe(true);
  });
});
