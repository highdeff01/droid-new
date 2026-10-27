import { describe, expect, it } from 'vitest';
import type { WorkflowStep } from './types.js';
import {
  RELAX_FACTOR,
  RELAX_PAUSE_MS,
  backgroundTestsAllowed,
  breakPeriodMs,
  breakText,
  relaxInterval,
  relaxStep,
} from './relax.js';

const step = (over: Partial<WorkflowStep> = {}): WorkflowStep => ({ id: 's1', name: 's1', action: 'click', x: 0.5, y: 0.5, status: 'pending', ...over });

describe('relaxInterval', () => {
  it('doubles an interval when relaxation mode is on', () => {
    expect(relaxInterval(1000, true)).toBe(1000 * RELAX_FACTOR);
  });

  it('leaves an interval unchanged when relaxation mode is off', () => {
    expect(relaxInterval(1000, false)).toBe(1000);
  });
});

describe('relaxStep', () => {
  it('returns the same step unchanged when relaxation mode is off', () => {
    const s = step({ delayMs: 300 });
    expect(relaxStep(s, false)).toBe(s);
  });

  it('doubles a recorded delay and adds the calm pause when on', () => {
    const s = step({ delayMs: 300 });
    expect(relaxStep(s, true).delayMs).toBe(300 * RELAX_FACTOR + RELAX_PAUSE_MS);
  });

  it('uses the default step delay when the step has no recorded delay', () => {
    const s = step();
    expect(relaxStep(s, true).delayMs).toBe(200 * RELAX_FACTOR + RELAX_PAUSE_MS);
  });
});

describe('backgroundTestsAllowed', () => {
  it('disallows background agent testing in relaxation mode', () => {
    expect(backgroundTestsAllowed(true)).toBe(false);
  });

  it('allows background agent testing outside relaxation mode', () => {
    expect(backgroundTestsAllowed(false)).toBe(true);
  });
});

describe('breakPeriodMs', () => {
  it('converts minutes to milliseconds', () => {
    expect(breakPeriodMs(45)).toBe(2_700_000);
  });
});

describe('breakText', () => {
  it('mentions the number of minutes that have passed', () => {
    expect(breakText(45)).toContain('45');
  });
});
