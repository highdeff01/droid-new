import { describe, expect, it, vi } from 'vitest';
import { autoContinue, judgeCheck, type ContinueDeps } from './auto-continue.js';
import type { GoalCheck } from './assist-ai.js';
import type { WorkflowStep } from './types.js';

const step = (name: string): WorkflowStep => ({ id: name, name, action: 'click', x: 0.5, y: 0.5, status: 'done' });
const check = (complete: boolean, progress = true): GoalCheck => ({ complete, progress, reason: complete ? 'done' : 'not yet', thinking: null });

/** Deps whose verify answers the given checks in order (the last repeats). */
function deps(checks: GoalCheck[], over: Partial<ContinueDeps> = {}) {
  const queue = [...checks];
  return {
    maxIterations: 5,
    aborted: () => false,
    run: vi.fn(async (n: number) => ({ ran: [step(`s${n}`)], halt: null })),
    verify: vi.fn(async () => (queue.length > 1 ? queue.shift()! : queue[0])),
    plan: vi.fn(async () => undefined),
    ...over,
  };
}

describe('autoContinue', () => {
  it('stops without re-planning when the first run is verified complete', async () => {
    const d = deps([check(true)]);
    await expect(autoContinue(d)).resolves.toMatchObject({ stop: 'complete', iterations: 0 });
    expect(d.plan).not.toHaveBeenCalled();
  });

  it('verifies, re-plans and runs again until the goal is verified complete', async () => {
    const d = deps([check(false), check(false), check(true)]);
    const r = await autoContinue(d);
    expect(r).toMatchObject({ stop: 'complete', iterations: 2 });
    expect(d.run).toHaveBeenCalledTimes(3);
    expect(d.verify).toHaveBeenCalledTimes(3);
    expect(d.plan).toHaveBeenCalledTimes(2);
    expect(d.plan).toHaveBeenNthCalledWith(1, [step('s0')], check(false), 1);
  });

  it('stops after two consecutive iterations with no verified progress and says why', async () => {
    const d = deps([check(false, true), check(false, false), check(false, false)]);
    const r = await autoContinue(d);
    expect(r.stop).toBe('no-progress');
    expect(r.detail).toMatch(/No verified progress in 2 consecutive iterations/);
    expect(d.plan).toHaveBeenCalledTimes(2);
  });

  it('a progress check resets the no-progress count', async () => {
    const d = deps([check(false, false), check(false, true), check(false, false), check(true)]);
    await expect(autoContinue(d)).resolves.toMatchObject({ stop: 'complete', iterations: 3 });
  });

  it('makes at most maxIterations continuation plans (default reading: first run not counted)', async () => {
    const d = deps([check(false)], { maxIterations: 2 });
    const r = await autoContinue(d);
    expect(r).toMatchObject({ stop: 'cap', iterations: 2 });
    expect(r.detail).toMatch(/Max iterations \(2\)/);
    expect(d.plan).toHaveBeenCalledTimes(2);
    expect(d.run).toHaveBeenCalledTimes(3);
  });

  it('stops when a run halts (action budget) without verifying', async () => {
    const d = deps([check(false)], { run: vi.fn(async () => ({ ran: [], halt: 'Action budget of 1 exceeded — not sent' })) });
    await expect(autoContinue(d)).resolves.toMatchObject({ stop: 'halted', detail: 'Action budget of 1 exceeded — not sent' });
    expect(d.verify).not.toHaveBeenCalled();
  });

  it('stops on abort after a run, with no verify or plan call', async () => {
    let aborted = false;
    const d = deps([check(false)], { aborted: () => aborted, run: vi.fn(async () => { aborted = true; return { ran: [], halt: null }; }) });
    await expect(autoContinue(d)).resolves.toMatchObject({ stop: 'aborted' });
    expect(d.verify).not.toHaveBeenCalled();
    expect(d.plan).not.toHaveBeenCalled();
  });

  it('rejects when the model call fails', async () => {
    const d = deps([check(false)], { verify: vi.fn(async () => { throw new Error('down'); }) });
    await expect(autoContinue(d)).rejects.toThrow('down');
  });
});

describe('judgeCheck', () => {
  it('stops on a complete goal', () => {
    expect(judgeCheck(check(true), 0, 0, 5)).toMatchObject({ stop: 'complete', detail: 'Goal verified complete — done' });
  });

  it('continues with the no-progress count reset by progress and raised without it', () => {
    expect(judgeCheck(check(false, true), 1, 0, 5)).toEqual({ stop: null, stalls: 0 });
    expect(judgeCheck(check(false, false), 0, 0, 5)).toEqual({ stop: null, stalls: 1 });
  });

  it('stops after two checks in a row without progress, and at the iteration cap', () => {
    expect(judgeCheck(check(false, false), 1, 0, 5).stop).toBe('no-progress');
    expect(judgeCheck(check(false, true), 0, 3, 3)).toMatchObject({ stop: 'cap', detail: expect.stringMatching(/Max iterations \(3\)/) });
  });
});
