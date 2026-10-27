import { describe, expect, it } from 'vitest';
import type { Frame, Habit, HabitAnchor, WorkflowStep } from './types.js';
import type { RunSummary } from './run-stats.js';
import type { SavedOperation } from './saved-operations.js';
import {
  DEFAULT_OPERATION_RETRIES,
  OPERATION_RETRIES_MAX,
  OPERATION_RETRIES_MIN,
  RECENT_MS,
  bestVariant,
  detectRecent,
  scoreVariant,
  verifyRetry,
} from './operation-retry.js';

const frame = (id: number, v: number): Frame => ({
  id,
  time: 0,
  url: 'data:image/jpeg;base64,x',
  data: { width: 320, height: 180, data: new Uint8ClampedArray(320 * 180 * 4).fill(v), colorSpace: 'srgb' } as unknown as ImageData,
  srcW: 1920,
  srcH: 1080,
  source: 'demo',
});

const step = (overrides: Partial<WorkflowStep> = {}): WorkflowStep => ({ id: 's1', name: 'Step', action: 'click', x: 0.5, y: 0.5, status: 'pending', ...overrides });

const op = (overrides: Partial<SavedOperation> = {}): SavedOperation => ({
  id: 'op1',
  name: 'Op',
  goal: 'open youtube in chrome',
  steps: [],
  screenshots: [],
  source: 'recorded',
  savedAt: 0,
  runs: 0,
  successes: 0,
  ...overrides,
});

const run = (overrides: Partial<RunSummary> = {}): RunSummary => ({
  id: 'r1', time: 0, session: 's', goal: 'open youtube in chrome', attempted: 1, succeeded: 1, durationMs: 100, outcome: 'success', ...overrides,
});

describe('detectRecent', () => {
  it('detects an op with a run summary flowId===op.id within RECENT_MS via "run"', () => {
    const o = op({ id: 'op1' });
    const r = run({ flowId: 'op1', time: 1_000_000 });
    const found = detectRecent([o], [r], [], 1_000_000 + 1000);
    expect(found).toEqual([{ op: o, via: 'run', time: r.time }]);
  });

  it('does not detect an older run summary outside RECENT_MS', () => {
    const o = op({ id: 'op1' });
    const r = run({ flowId: 'op1', time: 1_000_000 });
    const found = detectRecent([o], [r], [], 1_000_000 + RECENT_MS + 1);
    expect(found).toEqual([]);
  });

  it('detects an op whose steps appear in order in the performed steps (>=50%) via "steps"', () => {
    const o = op({ steps: [step({ action: 'click', target: 'a' }), step({ action: 'click', target: 'b' }), step({ action: 'click', target: 'c' }), step({ action: 'click', target: 'd' })] });
    const performed = [step({ action: 'click', target: 'a' }), step({ action: 'click', target: 'b' })];
    const found = detectRecent([o], [], performed, 5000);
    expect(found).toEqual([{ op: o, via: 'steps', time: 5000 }]);
  });

  it('does not detect an unrelated op', () => {
    const o = op({ steps: [step({ action: 'click', target: 'a' })] });
    const performed = [step({ action: 'type', target: 'z' })];
    expect(detectRecent([o], [], performed, 5000)).toEqual([]);
  });
});

describe('scoreVariant', () => {
  it('runRate is (successes + 1) / (runs + 2)', () => {
    const o = op({ runs: 3, successes: 2, steps: [] });
    expect(scoreVariant(o, [], 'ctx').runRate).toBeCloseTo(3 / 5);
  });

  it('habitRate is 0.5 with no habits', () => {
    const o = op({ steps: [step({ target: 'a' })] });
    expect(scoreVariant(o, [], 'ctx').habitRate).toBe(0.5);
  });

  it('habitRate is the mean rate of habits matching step targets in the same context', () => {
    const o = op({ steps: [step({ target: 'a' }), step({ target: 'b' })] });
    const habits: Habit[] = [
      { id: 'h1', target: 'a', context: 'ctx', attempts: 4, successes: 4, lastUsed: 0, lessons: [], pinned: false },
      { id: 'h2', target: 'b', context: 'ctx', attempts: 4, successes: 0, lastUsed: 0, lessons: [], pinned: false },
      { id: 'h3', target: 'a', context: 'other', attempts: 4, successes: 0, lastUsed: 0, lessons: [], pinned: false },
    ];
    expect(scoreVariant(o, habits, 'ctx').habitRate).toBeCloseTo(0.5);
  });

  it('adds 0.05 per target with an anchored, reliable habit', () => {
    const anchor: HabitAnchor = { x: 0.5, y: 0.5, size: 1, patch: [0], time: 0 };
    const o = op({ steps: [step({ target: 'a' })] });
    const habits: Habit[] = [{ id: 'h1', target: 'a', context: 'ctx', attempts: 3, successes: 2, anchor, lastUsed: 0, lessons: [], pinned: false }];
    expect(scoreVariant(o, habits, 'ctx').anchors).toBe(1);
  });

  it('score is 0.6 * runRate + 0.4 * habitRate + 0.05 * anchors', () => {
    const anchor: HabitAnchor = { x: 0.5, y: 0.5, size: 1, patch: [0], time: 0 };
    const o = op({ runs: 3, successes: 2, steps: [step({ target: 'a' })] });
    const habits: Habit[] = [{ id: 'h1', target: 'a', context: 'ctx', attempts: 3, successes: 2, anchor, lastUsed: 0, lessons: [], pinned: false }];
    const result = scoreVariant(o, habits, 'ctx');
    expect(result.score).toBeCloseTo(0.6 * result.runRate + 0.4 * result.habitRate + 0.05 * result.anchors);
  });
});

describe('bestVariant', () => {
  it('picks the same-goal variant with the higher score', () => {
    const weak = op({ id: 'weak', goal: 'open youtube in chrome', runs: 10, successes: 0 });
    const strong = op({ id: 'strong', goal: 'open youtube in chrome', runs: 10, successes: 10 });
    const best = bestVariant(weak, [weak, strong], [], 'ctx');
    expect(best.op).toBe(strong);
  });
});

describe('verifyRetry', () => {
  it('is verified when the reference is identical to after', () => {
    const after = frame(1, 100);
    const reference = frame(2, 100);
    expect(verifyRetry(after, null, reference, true).verified).toBe(true);
  });

  it('is not verified when the reference is very different from after', () => {
    const after = frame(1, 0);
    const reference = frame(2, 255);
    expect(verifyRetry(after, null, reference, true).verified).toBe(false);
  });

  it('with no reference: verified when every step executed and the screen changed', () => {
    const before = frame(1, 0);
    const after = frame(2, 100);
    expect(verifyRetry(after, before, null, true).verified).toBe(true);
  });

  it('with no reference: not verified when the screen is unchanged', () => {
    const before = frame(1, 50);
    const after = frame(2, 50);
    expect(verifyRetry(after, before, null, true).verified).toBe(false);
  });

  it('is not verified when after is null', () => {
    expect(verifyRetry(null, frame(1, 50), null, true).verified).toBe(false);
  });

  it('exposes the retry setting range and default', () => {
    expect(DEFAULT_OPERATION_RETRIES).toBe(2);
    expect(OPERATION_RETRIES_MIN).toBe(0);
    expect(OPERATION_RETRIES_MAX).toBe(10);
  });
});
