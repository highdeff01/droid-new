import { describe, expect, it } from 'vitest';
import { findScript, runnableSteps, saveScript, validateScript, type SavedScript } from './script-op.js';
import { MAX_FIX_STEPS } from './fix-script.js';

describe('validateScript', () => {
  it('accepts click/type/key/wait (click needs x,y in 0..1)', () => {
    const r = validateScript([
      { action: 'click', target: 'Menu', x: 0.5, y: 0.5 },
      { action: 'type', text: 'hi' },
      { action: 'key', text: 'Escape' },
      { action: 'wait' },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.steps).toHaveLength(4);
  });

  it('refuses an empty array', () => {
    const r = validateScript([]);
    expect(r.ok).toBe(false);
  });

  it('refuses a non-array', () => {
    const r = validateScript({ steps: [] });
    expect(r.ok).toBe(false);
  });

  it('refuses MAX_FIX_STEPS+1 steps (whole script refused)', () => {
    const steps = Array.from({ length: MAX_FIX_STEPS + 1 }, () => ({ action: 'wait' }));
    const r = validateScript(steps);
    expect(r.ok).toBe(false);
  });

  it('refuses a disallowed action \'drag\'', () => {
    const r = validateScript([{ action: 'drag', x: 0.5, y: 0.5, endX: 0.6, endY: 0.6 }]);
    expect(r.ok).toBe(false);
  });

  it('refuses a click without coordinates', () => {
    const r = validateScript([{ action: 'click', target: 'Menu' }]);
    expect(r.ok).toBe(false);
  });
});

describe('saveScript', () => {
  it('newest first', () => {
    const list = saveScript([], 'First', 'desc', [], 1);
    const list2 = saveScript(list, 'Second', 'desc', [], 2);
    expect(list2.map((s) => s.name)).toEqual(['Second', 'First']);
  });

  it('replaces same-name script case-insensitively', () => {
    const list = saveScript([], 'Export Report', 'old', [], 1);
    const list2 = saveScript(list, 'EXPORT REPORT', 'new', [], 2);
    expect(list2).toHaveLength(1);
    expect(list2[0].description).toBe('new');
  });
});

describe('findScript', () => {
  const list: SavedScript[] = saveScript([], 'Export Report', 'desc', [], 1);

  it('is case-insensitive', () => {
    expect(findScript(list, 'export report')).not.toBeNull();
  });

  it('is null when missing', () => {
    expect(findScript(list, 'nope')).toBeNull();
  });
});

describe('runnableSteps', () => {
  it('fresh ids and pending status', () => {
    const list = saveScript([], 'Script', 'desc', [{ id: 'old', name: 'Click', action: 'click', x: 0.5, y: 0.5, status: 'done' }], 1);
    const steps = runnableSteps(list[0]);
    expect(steps[0].id).not.toBe('old');
    expect(steps[0].status).toBe('pending');
  });
});
