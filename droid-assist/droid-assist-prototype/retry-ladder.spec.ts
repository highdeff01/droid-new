import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STEP_RETRIES,
  STEP_RETRIES_MAX,
  avoidPattern,
  describeAttempt,
  runLadder,
  toAttempt,
  type Attempt,
  type LadderDeps,
  type LadderOutcome,
} from './retry-ladder.js';
import type { Frame, LogEntry, WorkflowStep } from './types.js';
import type { DriftCorrection } from './drift.js';

type LogLine = { message: string; tone: LogEntry['tone'] };

const step: WorkflowStep = { id: 's1', name: 'Click Save', action: 'click', x: 0.5, y: 0.5, status: 'pending' };

function outcome(ok: boolean, message = 'missed', extra: Partial<LadderOutcome> = {}): LadderOutcome {
  return { ok, executed: ok, message, target: { x: 0.5, y: 0.5 }, ...extra };
}

/** Queues outcomes for a fake `run`, repeating the last once exhausted; `patch` overrides any other dep. */
function makeDeps(outcomes: LadderOutcome[], patch: Partial<LadderDeps<LadderOutcome>> = {}) {
  const lines: LogLine[] = [];
  const queue = [...outcomes];
  const run = vi.fn(async (_step: WorkflowStep) => queue.shift() ?? outcomes[outcomes.length - 1]);
  const onAttempt = vi.fn();
  const log = vi.fn((message: string, tone: LogEntry['tone']) => lines.push({ message, tone }));
  const deps: LadderDeps<LadderOutcome> = {
    retries: DEFAULT_STEP_RETRIES,
    run,
    stopped: () => null,
    replan: async () => null,
    onAttempt,
    log,
    ...patch,
  };
  return { deps, run, onAttempt, log, lines };
}

describe('runLadder', () => {
  it('succeeds on the first attempt and never retries or replans', async () => {
    const replan = vi.fn(async () => null);
    const { deps, run } = makeDeps([outcome(true)], { replan });
    const result = await runLadder(step, deps);
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.attempts).toHaveLength(1);
    expect(result.exhausted).toBe(false);
    expect(replan).not.toHaveBeenCalled();
  });

  it('retries the original step on failure until it succeeds', async () => {
    const replan = vi.fn(async () => null);
    const { deps, run, onAttempt } = makeDeps([outcome(false), outcome(false), outcome(true)], { retries: 2, replan });
    const result = await runLadder(step, deps);
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls.every(([s]) => s === step)).toBe(true);
    expect(result.attempts.map((a) => a.kind)).toEqual(['first', 'retry', 'retry']);
    expect(onAttempt).toHaveBeenCalledTimes(3);
    expect(replan).not.toHaveBeenCalled();
    expect(result.exhausted).toBe(false);
  });

  it('hands the step to the planner once retries are exhausted and succeeds on the re-plan', async () => {
    const replannedStep: WorkflowStep = { ...step, id: 's2' };
    const replan = vi.fn(async () => replannedStep);
    const { deps, run } = makeDeps([outcome(false, 'missed'), outcome(false, 'missed'), outcome(false, 'missed'), outcome(true)], {
      retries: 2,
      replan,
    });
    const result = await runLadder(step, deps);
    expect(run).toHaveBeenCalledTimes(4);
    expect(replan).toHaveBeenCalledTimes(1);
    expect(replan).toHaveBeenCalledWith(step, 'missed');
    expect(run.mock.calls[3][0]).toBe(replannedStep);
    expect(result.attempts.at(-1)?.kind).toBe('replan');
    expect(result.exhausted).toBe(false);
  });

  it('marks the step exhausted when the re-planned step also fails', async () => {
    const replannedStep: WorkflowStep = { ...step, id: 's3' };
    const replan = vi.fn(async () => replannedStep);
    const { deps, run } = makeDeps(
      [outcome(false, 'missed'), outcome(false, 'missed'), outcome(false, 'missed'), outcome(false, 'still missed')],
      { retries: 2, replan },
    );
    const result = await runLadder(step, deps);
    expect(run).toHaveBeenCalledTimes(4);
    expect(result.exhausted).toBe(true);
  });

  it('gives up when the planner resolves no re-plan', async () => {
    const replan = vi.fn(async () => null);
    const { deps, run, lines } = makeDeps([outcome(false), outcome(false), outcome(false)], { retries: 2, replan });
    const result = await runLadder(step, deps);
    expect(run).toHaveBeenCalledTimes(3);
    expect(result.attempts).toHaveLength(3);
    expect(result.exhausted).toBe(true);
    expect(lines.some((l) => l.tone === 'error')).toBe(true);
  });

  it('gives up when the planner rejects', async () => {
    const replan = vi.fn(async () => {
      throw new Error('planner offline');
    });
    const { deps, run, lines } = makeDeps([outcome(false), outcome(false), outcome(false)], { retries: 2, replan });
    const result = await runLadder(step, deps);
    expect(run).toHaveBeenCalledTimes(3);
    expect(result.attempts).toHaveLength(3);
    expect(result.exhausted).toBe(true);
    expect(lines.some((l) => l.tone === 'error')).toBe(true);
  });

  it('stops at once on a halted first outcome without retrying or replanning', async () => {
    const replan = vi.fn(async () => null);
    const { deps, run } = makeDeps([outcome(false, 'budget', { halt: true })], { replan });
    const result = await runLadder(step, deps);
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.exhausted).toBe(false);
    expect(replan).not.toHaveBeenCalled();
  });

  it('stops the ladder when a guardrail refuses the next rung', async () => {
    const stopped = vi.fn(() => 'action budget exceeded');
    const replan = vi.fn(async () => null);
    const { deps, run, lines } = makeDeps([outcome(false, 'missed')], { stopped, replan });
    const result = await runLadder(step, deps);
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.exhausted).toBe(false);
    expect(replan).not.toHaveBeenCalled();
    expect(lines.some((l) => l.message.includes('action budget exceeded'))).toBe(true);
  });

  it('goes straight to the planner when retries is 0', async () => {
    const replannedStep: WorkflowStep = { ...step, id: 's4' };
    const replan = vi.fn(async () => replannedStep);
    const { deps, run } = makeDeps([outcome(false, 'missed'), outcome(true)], { retries: 0, replan });
    const result = await runLadder(step, deps);
    expect(run).toHaveBeenCalledTimes(2);
    expect(replan).toHaveBeenCalledTimes(1);
    expect(result.exhausted).toBe(false);
  });

  it('clamps an out-of-range retries setting to STEP_RETRIES_MAX before replanning', async () => {
    const outcomes = Array.from({ length: STEP_RETRIES_MAX + 1 }, () => outcome(false, 'missed'));
    const replan = vi.fn(async () => null);
    const { deps, run } = makeDeps(outcomes, { retries: 99, replan });
    await runLadder(step, deps);
    expect(run).toHaveBeenCalledTimes(STEP_RETRIES_MAX + 1);
    expect(replan).toHaveBeenCalledTimes(1);
  });
});

describe('describeAttempt', () => {
  it('reports the rung, outcome, verify text with drift/correction and native pixel coordinates', () => {
    const live = { srcW: 1920, srcH: 1080 } as Frame;
    const correction: DriftCorrection = {
      level: 'yellow',
      x: 0.6,
      y: 0.4,
      dxPx: 12,
      dyPx: -8,
      driftPx: 14,
      regionDistance: 0.1,
      matchDistance: 0.2,
      widened: false,
    };
    const out = outcome(false, 'click missed', { target: { x: 0.6, y: 0.4 }, correction, live });
    const attempt = toAttempt(2, 'retry', out);
    const text = describeAttempt(attempt, 2);
    expect(text).toContain('Attempt 2 (retry 1/2)');
    expect(text).toContain('FAILED');
    expect(text).toContain('target verified (yellow, drift 14px, corrected by (12, -8)px)');
    expect(text).toContain(`(${Math.round(0.6 * 1920)}, ${Math.round(0.4 * 1080)})px`);
    expect(text).toContain('click missed');
  });

  it('marks a successful attempt OK', () => {
    const attempt = toAttempt(1, 'first', outcome(true, 'done'));
    expect(describeAttempt(attempt, 2)).toContain('OK');
  });
});

describe('avoidPattern', () => {
  it('names the action, target, attempt count and the last failure message', () => {
    const named: WorkflowStep = { ...step, action: 'click', target: 'Save button' };
    const attempts: Attempt[] = [
      toAttempt(1, 'first', outcome(false, 'missed once')),
      toAttempt(2, 'retry', outcome(false, 'missed twice')),
    ];
    const text = avoidPattern(named, attempts);
    expect(text).toContain('click');
    expect(text).toContain('Save button');
    expect(text).toContain('2 attempt(s)');
    expect(text).toContain('missed twice');
  });
});
