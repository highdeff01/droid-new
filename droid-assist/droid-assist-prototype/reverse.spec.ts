import { describe, expect, it } from 'vitest';
import type { ActionRecord, WorkflowStep } from './types.js';
import { REVERSE_ACTOR, reverseAction, reverseOffer } from './reverse.js';

const rec = (over: Partial<ActionRecord> = {}): ActionRecord => ({
  id: 'a1', time: Date.UTC(2026, 0, 2, 3, 4, 5), action: 'click', x: 100, y: 100,
  source: 'Replay', via: 'bridge', ok: true, message: 'Dispatched', srcW: 1000, srcH: 500, ...over,
});

/** Every reversal step must be queued (not yet run) and clearly labelled as a reversal. */
const expectStep = (s: WorkflowStep) => {
  expect(s.status).toBe('pending');
  expect(s.name.startsWith('Reverse:')).toBe(true);
};

describe('reverseAction', () => {
  it('drag drags back from the release point to the recorded start point', () => {
    const r = reverseAction(rec({ action: 'drag', x: 100, y: 50, endX: 900, endY: 400 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.steps).toHaveLength(1);
    expectStep(r.steps[0]);
    expect(r.steps[0]).toMatchObject({ action: 'drag', x: 0.9, y: 0.8, endX: 0.1, endY: 0.1 });
  });

  it('drag without a recorded release point cannot be reversed', () => {
    const r = reverseAction(rec({ action: 'drag', x: 100, y: 50 }));
    expect(r.ok).toBe(false);
  });

  it('click with a previously-focused point clicks it back', () => {
    const r = reverseAction(rec({ action: 'click', x: 200, y: 200, prevX: 500, prevY: 250 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expectStep(r.steps[0]);
    expect(r.steps[0]).toMatchObject({ action: 'click', x: 0.5, y: 0.5 });
    expect(r.summary).toContain('previously-focused');
  });

  it('click without a previous focus point clicks the original target', () => {
    const r = reverseAction(rec({ action: 'click', x: 200, y: 200 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expectStep(r.steps[0]);
    expect(r.steps[0]).toMatchObject({ action: 'click', x: 0.2, y: 0.4 });
  });

  it('double_click reverses the same way as click', () => {
    const r = reverseAction(rec({ action: 'double_click', x: 200, y: 200, prevX: 500, prevY: 250 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expectStep(r.steps[0]);
    expect(r.steps[0]).toMatchObject({ action: 'click', x: 0.5, y: 0.5 });
  });

  it('move returns the pointer to its recorded prior position', () => {
    const r = reverseAction(rec({ action: 'move', x: 200, y: 200, prevX: 500, prevY: 250 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expectStep(r.steps[0]);
    expect(r.steps[0]).toMatchObject({ action: 'move', x: 0.5, y: 0.5 });
  });

  it('move without a recorded prior position cannot be reversed', () => {
    const r = reverseAction(rec({ action: 'move', x: 200, y: 200 }));
    expect(r.ok).toBe(false);
  });

  it('type with known prior text selects the field and retypes it', () => {
    const r = reverseAction(rec({ action: 'type', x: 100, y: 100, text: 'hello', priorText: 'old' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.steps).toHaveLength(2);
    r.steps.forEach(expectStep);
    expect(r.steps[0]).toMatchObject({ action: 'key', text: 'ctrl+a' });
    expect(r.steps[1]).toMatchObject({ action: 'type', text: 'old' });
  });

  it('type with an empty prior text clears the field instead of retyping', () => {
    const r = reverseAction(rec({ action: 'type', x: 100, y: 100, text: 'hello', priorText: '' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.steps).toHaveLength(2);
    r.steps.forEach(expectStep);
    expect(r.steps[0]).toMatchObject({ action: 'key', text: 'ctrl+a' });
    expect(r.steps[1]).toMatchObject({ action: 'key', text: 'backspace' });
  });

  it('type with unknown prior text erases the typed length with backspaces', () => {
    const r = reverseAction(rec({ action: 'type', x: 100, y: 100, text: 'hello' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.steps).toHaveLength(1);
    expectStep(r.steps[0]);
    expect(r.steps[0]).toMatchObject({ action: 'key', text: 'backspace', repeat: 5 });
  });

  it('type with neither typed text nor prior text cannot be reversed', () => {
    const r = reverseAction(rec({ action: 'type', x: 100, y: 100 }));
    expect(r.ok).toBe(false);
  });

  it('key "up" reverses to "down"', () => {
    const r = reverseAction(rec({ action: 'key', x: 100, y: 100, text: 'up' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expectStep(r.steps[0]);
    expect(r.steps[0]).toMatchObject({ action: 'key', text: 'down' });
  });

  it('key "ctrl+z" reverses to "ctrl+y"', () => {
    const r = reverseAction(rec({ action: 'key', x: 100, y: 100, text: 'ctrl+z' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.steps[0]).toMatchObject({ text: 'ctrl+y' });
  });

  it('key "pageup" reverses to "pagedown"', () => {
    const r = reverseAction(rec({ action: 'key', x: 100, y: 100, text: 'pageup' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.steps[0]).toMatchObject({ text: 'pagedown' });
  });

  it('key "enter" has no known inverse', () => {
    const r = reverseAction(rec({ action: 'key', x: 100, y: 100, text: 'enter' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('no known inverse');
  });

  it('scroll "down" reverses to scrolling up at the same point', () => {
    const r = reverseAction(rec({ action: 'scroll', x: 300, y: 100, text: 'down' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expectStep(r.steps[0]);
    expect(r.steps[0]).toMatchObject({ action: 'scroll', text: 'up', x: 0.3, y: 0.2 });
  });

  it('scroll "up" reverses to scrolling down at the same point', () => {
    const r = reverseAction(rec({ action: 'scroll', x: 300, y: 100, text: 'up' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.steps[0]).toMatchObject({ action: 'scroll', text: 'down' });
  });

  it('a record that did not complete cannot be reversed', () => {
    const r = reverseAction(rec({ action: 'click', x: 100, y: 100, ok: false }));
    expect(r.ok).toBe(false);
  });

  it('a record without a recorded screen size cannot be reversed', () => {
    const r = reverseAction(rec({ action: 'click', x: 100, y: 100, srcW: undefined }));
    expect(r.ok).toBe(false);
  });
});

describe('reverseOffer', () => {
  it('offers nothing for an empty history', () => {
    expect(reverseOffer([])).toBeNull();
  });

  it('offers nothing when the newest record is itself a reversal', () => {
    const history = [rec({ id: 'r1', source: REVERSE_ACTOR })];
    expect(reverseOffer(history)).toBeNull();
  });

  it('offers the newest real record with its reversal', () => {
    const newest = rec({ id: 'r2', action: 'click', x: 100, y: 100 });
    const older = rec({ id: 'r1' });
    const offer = reverseOffer([newest, older]);
    expect(offer).not.toBeNull();
    expect(offer?.record).toBe(newest);
    expect(offer?.reversal).toEqual(reverseAction(newest));
  });
});
