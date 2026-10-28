import { describe, expect, it } from 'vitest';
import type { WorkflowStep } from './types.js';
import type { Knowledge } from './cross-reference.js';
import { gateStep } from './dispatch-gate.js';
import {
  DISMISS_COOLDOWN_MS, RELEARN_WINDOW_MS, blockingRule, deadlockRules, decisiveReason, isAvoidRule, isBlocking, isDismissal,
  pruneRules, recordFailure, ruleLine, ruleReason, ttlMs, withoutRules, type AvoidRule, type FailureEvent,
} from './blacklist.js';

const HOUR = 3_600_000;
const TTL = 24 * HOUR;
const step = (over: Partial<WorkflowStep> = {}): WorkflowStep => ({ id: 's', name: 'Open Files', action: 'click', target: 'Files icon', x: 0.1, y: 0.2, status: 'pending', ...over });
const knowledge = (over: Partial<Knowledge> = {}): Knowledge => ({ map: [], familiar: [], habits: [], patterns: [], failures: [], dossiers: [], memory: [], context: '', ...over });
const fail = (rules: AvoidRule[], s: WorkflowStep, now: number, over: Partial<FailureEvent> = {}) => recordFailure(rules, { step: s, message: 'Click hit nothing interactive', source: 'habit', ttl: TTL, now, ...over });
/** A rule learned from two fresh failures of `s` at `now`. */
const learned = (s: WorkflowStep, now = 0) => fail(fail([], s, now), s, now);

describe('prose avoid never blocks dispatch', () => {
  const PROSE = 'Do not wait if clicking a UI element directly. Jump straight to click instructions when clicking icons, text, or specific game actions (like Archive)';

  it('a free-text avoid pattern and habit lesson leave every click free to dispatch', () => {
    const k = knowledge({
      patterns: [{ id: 'p', kind: 'avoid', pattern: PROSE, context: '', time: 1 }],
      habits: [{ id: 'h', target: 'Files icon', context: '', attempts: 3, successes: 0, lastUsed: 1, pinned: false, lessons: [{ kind: 'avoid', text: PROSE, time: 1 }] }],
    });
    for (const s of [step(), step({ name: 'Self-test: click Files icon' }), step({ name: 'Dismiss MEGA OFFER popup', target: 'MEGA OFFER close' })]) {
      expect(gateStep(s, k, [], true)).toBeNull();
    }
  });
});

describe('structured avoid blocks only its scope', () => {
  const rules = learned(step());

  it('blocks the same action on the same target near the same point', () => {
    expect(blockingRule(rules, step({ x: 0.11, y: 0.21 }), 1)?.target).toBe('Files icon');
  });

  it('leaves another point, another action and another target free', () => {
    expect(blockingRule(rules, step({ x: 0.5, y: 0.5 }), 1)).toBeNull();
    expect(blockingRule(rules, step({ action: 'double_click' as WorkflowStep['action'] }), 1)).toBeNull();
    expect(blockingRule(rules, step({ target: 'Trash icon' }), 1)).toBeNull();
  });

  it('"Click 1" never matches a "Click 6" rule (no blanket block by step name)', () => {
    const click6 = learned(step({ name: 'Click 6', target: undefined, x: 0.06, y: 0.6 }));
    expect(blockingRule(click6, step({ name: 'Click 1', target: undefined, x: 0.06, y: 0.6 }), 1)).toBeNull();
    expect(blockingRule(click6, step({ name: 'Click 6', target: undefined, x: 0.06, y: 0.6 }), 1)).not.toBeNull();
  });

  it('a single fresh failure does not block; a second within the window does; one after it starts over', () => {
    const once = fail([], step(), 0);
    expect(blockingRule(once, step(), 1)).toBeNull();
    expect(blockingRule(fail(once, step(), HOUR / 2), step(), HOUR / 2 + 1)).not.toBeNull();
    const late = fail(once, step(), RELEARN_WINDOW_MS + 1);
    expect(late[0].strikes).toBe(1);
    expect(blockingRule(late, step(), RELEARN_WINDOW_MS + 2)).toBeNull();
  });

  it('a block outcome is never learned as a failure', () => {
    expect(fail([], step(), 0, { message: '"Open Files" not dispatched — blacklisted — Habit avoid: x' })).toEqual([]);
  });
});

describe('TTL expiry', () => {
  it('a blocking rule lives for the configured TTL and is gone after it', () => {
    const rules = learned(step(), 0);
    expect(rules[0].expiresAt).toBe(TTL);
    expect(blockingRule(rules, step(), TTL - 1)).not.toBeNull();
    expect(blockingRule(rules, step(), TTL)).toBeNull();
    expect(pruneRules(rules, TTL)).toEqual([]);
  });

  it('the TTL setting is in hours, clamped to 1..168', () => {
    expect(ttlMs(24)).toBe(TTL);
    expect(ttlMs(0)).toBe(HOUR);
    expect(ttlMs(1000)).toBe(168 * HOUR);
    const short = fail(fail([], step(), 0, { ttl: ttlMs(2) }), step(), 0, { ttl: ttlMs(2) });
    expect(blockingRule(short, step(), 2 * HOUR)).toBeNull();
  });
});

describe('popup dismissal is never permanently blacklisted', () => {
  const dismiss = step({ name: 'Dismiss MEGA OFFER popup', target: 'MEGA OFFER close button', x: 0.8, y: 0.15 });

  it('recognises popup/overlay dismissals', () => {
    expect(isDismissal(dismiss)).toBe(true);
    expect(isDismissal(step())).toBe(false);
  });

  it('a failed dry-run click on a popup gets only a short cooldown, however often it fails', () => {
    let rules: AvoidRule[] = [];
    for (let i = 0; i < 5; i++) rules = fail(rules, dismiss, 0, { source: 'test' });
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe('dismissal');
    expect(rules[0].expiresAt).toBe(DISMISS_COOLDOWN_MS);
    expect(blockingRule(rules, dismiss, DISMISS_COOLDOWN_MS - 1)).not.toBeNull();
    expect(blockingRule(rules, dismiss, DISMISS_COOLDOWN_MS)).toBeNull();
  });
});

describe('deadlock auto-clear', () => {
  const dismiss = step({ name: 'Dismiss MEGA OFFER popup', target: 'MEGA OFFER close button', x: 0.8, y: 0.15 });
  const files = step({ name: 'Self-test: click Files icon' });
  const rules = [...fail([], dismiss, 0), ...learned(step({ target: 'Trash icon', x: 0.3, y: 0.3 }))];

  it('with the popup on screen, the blacklisted dismissal of that popup is cleared (other rules survive)', () => {
    const stuck = deadlockRules(rules, dismiss, true, 1);
    expect(stuck.map((r) => r.target)).toEqual(['MEGA OFFER close button']);
    const after = withoutRules(rules, stuck);
    expect(blockingRule(after, dismiss, 1)).toBeNull();
    expect(after.map((r) => r.target)).toEqual(['Trash icon']);
  });

  it('a target the popup covers clears every blacklisted dismissal so the obstacle can be dismissed', () => {
    expect(deadlockRules(rules, files, true, 1).map((r) => r.target)).toEqual(['MEGA OFFER close button']);
  });

  it('nothing is cleared without a detected obstacle', () => {
    expect(deadlockRules(rules, dismiss, false, 1)).toEqual([]);
  });
});

describe('single decisive reason', () => {
  it('strips nested block prefixes so a reason never chains', () => {
    expect(decisiveReason('not dispatched — blacklisted — Learned avoid: blacklisted — Learned avoid: Click hit nothing interactive — not executed')).toBe('Click hit nothing interactive');
    const [rule] = learned(step());
    expect(ruleReason(rule).match(/blacklisted/g)).toHaveLength(1);
  });

  it('shows a rule with its scope, source, state and expiry; stored rules round-trip', () => {
    const [rule] = learned(step(), 0);
    expect(ruleLine(rule, 0)).toMatch(/Habit avoid click "Files icon" near \(10\.0%, 20\.0%\) \(blocking, expires in 24 h\)/);
    expect(isBlocking(rule, 0)).toBe(true);
    expect(isAvoidRule(JSON.parse(JSON.stringify(rule)))).toBe(true);
    expect(isAvoidRule({ ...rule, target: ' ' })).toBe(false);
  });
});
