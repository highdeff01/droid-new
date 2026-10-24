import { describe, it, expect } from 'vitest';
import {
  hotkeyFromEvent,
  matchesHotkey,
  sanitizeBudget,
  createBudget,
  spendAction,
  DEFAULT_ACTION_BUDGET,
  type HotkeyEvent,
} from './safety.js';

function keyEvent(overrides: Partial<HotkeyEvent> & Pick<HotkeyEvent, 'key'>): HotkeyEvent {
  return {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides,
  };
}

describe('hotkeyFromEvent', () => {
  it('renders a Shift+Escape event as "Shift+Escape"', () => {
    const e = keyEvent({ key: 'Escape', shiftKey: true });
    expect(hotkeyFromEvent(e)).toBe('Shift+Escape');
  });

  it('names the space bar "Space" so a Ctrl+Space combo survives trimming and still matches', () => {
    const e = keyEvent({ key: ' ', ctrlKey: true });
    expect(hotkeyFromEvent(e)).toBe('Ctrl+Space');
    expect(matchesHotkey(e, 'Ctrl+Space')).toBe(true);
  });

  it('uppercases letter keys and orders modifiers Ctrl, Alt, Shift, Meta', () => {
    const e = keyEvent({ key: 'k', ctrlKey: true, shiftKey: true });
    expect(hotkeyFromEvent(e)).toBe('Ctrl+Shift+K');
  });

  it('returns "" for a lone modifier key press', () => {
    const e = keyEvent({ key: 'Shift', shiftKey: true });
    expect(hotkeyFromEvent(e)).toBe('');
  });
});

describe('matchesHotkey', () => {
  it('matches the exact combo case-insensitively', () => {
    const e = keyEvent({ key: 'Escape', shiftKey: true });
    expect(matchesHotkey(e, 'shift+escape')).toBe(true);
  });

  it('does not match when an extra modifier is held', () => {
    const e = keyEvent({ key: 'Escape', ctrlKey: true, shiftKey: true });
    expect(matchesHotkey(e, 'Shift+Escape')).toBe(false);
  });

  it('does not match plain Escape against "Shift+Escape"', () => {
    const e = keyEvent({ key: 'Escape' });
    expect(matchesHotkey(e, 'Shift+Escape')).toBe(false);
  });
});

describe('sanitizeBudget', () => {
  it('maps NaN and Infinity to DEFAULT_ACTION_BUDGET', () => {
    expect(sanitizeBudget(NaN)).toBe(DEFAULT_ACTION_BUDGET);
    expect(sanitizeBudget(Infinity)).toBe(DEFAULT_ACTION_BUDGET);
  });

  it('floors non-positive values up to 1', () => {
    expect(sanitizeBudget(0)).toBe(1);
    expect(sanitizeBudget(-5)).toBe(1);
  });

  it('floors fractional values down', () => {
    expect(sanitizeBudget(7.9)).toBe(7);
  });

  it('keeps DEFAULT_ACTION_BUDGET conservative (<= 50)', () => {
    expect(DEFAULT_ACTION_BUDGET).toBeLessThanOrEqual(50);
  });
});

describe('spendAction', () => {
  it('allows exactly as many spends as the limit, then refuses further spends', () => {
    const budget = createBudget(2);
    expect(spendAction(budget)).toBe(true);
    expect(spendAction(budget)).toBe(true);
    expect(spendAction(budget)).toBe(false);
    expect(budget.used).toBe(2);
  });

  it('never leaves a run unlimited when created with an invalid limit', () => {
    expect(createBudget(NaN).limit).toBe(50);
  });
});
