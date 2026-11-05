import { describe, expect, it } from 'vitest';
import { applyHabitUpdates, crossReference, crossTestLine, habitUpdates, recallMethods, type CrossTest, type PriorMethod } from './cross-testing.js';
import type { Habit } from './types.js';

const test = (app: CrossTest['app'], subject: string, method: string, ok: boolean, at = 100): CrossTest => ({ app, subject, method, ok, evidence: 'screenshot', at });

describe('recallMethods', () => {
  it('recalls a subject from both apps, newest first', () => {
    const history: PriorMethod[] = [
      { app: 'droid-new', subject: 'Files', method: 'click icon', ok: true, at: 1 },
      { app: 'droid-main', subject: 'files', method: 'hotkey', ok: false, at: 5 },
      { app: 'droid-new', subject: 'Other', method: 'x', ok: true, at: 9 },
    ];
    expect(recallMethods(history, 'FILES').map((m) => m.method)).toEqual(['hotkey', 'click icon']);
  });
});

describe('crossReference', () => {
  it('brings both apps\u2019 methods and logs together as context', () => {
    const history: PriorMethod[] = [{ app: 'droid-main', subject: 'Files', method: 'hotkey', ok: false, at: 1 }];
    const ctx = crossReference('Files', history, ['droid-new: opened']);
    expect(ctx).toContain('[droid-main failed] hotkey');
    expect(ctx).toContain('log: droid-new: opened');
  });
});

describe('habitUpdates', () => {
  it('folds per subject+method, most recent wins', () => {
    const updates = habitUpdates([test('droid-new', 'Files', 'click', false, 1), test('droid-main', 'files', 'click', true, 2)]);
    expect(updates).toEqual([{ target: 'files', context: 'click', success: true, from: 'droid-main' }]);
  });
});

describe('applyHabitUpdates', () => {
  const habit = (target: string, context: string): Habit => ({ id: `${target}-${context}`, target, context, attempts: 3, successes: 2, lastUsed: 1, lessons: [], pinned: false });

  it('strengthens a matching habit in place, so a success in one app counts in the other', () => {
    const out = applyHabitUpdates([habit('Files', 'click')], [{ target: 'files', context: 'CLICK', success: true, from: 'droid-main' }], 50);
    expect(out[0]).toMatchObject({ attempts: 4, successes: 3, lastUsed: 50 });
    expect(out[0].lessons[0]).toMatchObject({ kind: 'add', text: 'cross-app test on droid-main: passed' });
  });

  it('creates a habit for a route no store had yet', () => {
    const out = applyHabitUpdates([], [{ target: 'Files', context: 'hotkey', success: false, from: 'droid-new' }], 9);
    expect(out[0]).toMatchObject({ target: 'Files', context: 'hotkey', attempts: 1, successes: 0 });
    expect(out[0].lessons[0].kind).toBe('avoid');
  });

  it('records a failure as a failed attempt', () => {
    const out = applyHabitUpdates([habit('Files', 'click')], [{ target: 'Files', context: 'click', success: false, from: 'droid-new' }], 50);
    expect(out[0]).toMatchObject({ attempts: 4, successes: 2 });
  });
});

describe('crossTestLine', () => {
  it('summarises the batch', () => {
    expect(crossTestLine([test('droid-new', 'a', 'x', true), test('droid-main', 'b', 'y', false)])).toBe('Cross-app tests (droid-new, droid-main): 1/2 passed — habits strengthened in both apps');
  });
});
