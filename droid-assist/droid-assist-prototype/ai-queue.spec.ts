import { describe, expect, it, vi } from 'vitest';
import { AiCancelled } from './ai.js';
import { DEFAULT_AI_MAX_IN_FLIGHT, createAiQueue, drainedText, stagePriority } from './ai-queue.js';
import type { StageId } from './loop-control.js';

/** A task that records when it started and settles only when told to. */
function gate(started: string[], name: string) {
  let release!: (v: string) => void;
  const done = new Promise<string>((r) => {
    release = r;
  });
  const task = vi.fn(() => {
    started.push(name);
    return done;
  });
  return { task, release: () => release(name) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('stagePriority', () => {
  it('puts executor/grounding first, planner/verdict next and background agents last', () => {
    expect(stagePriority('executor')).toBe(0);
    expect(stagePriority('grounding')).toBe(0);
    expect(stagePriority('planner')).toBe(1);
    expect(stagePriority('verdict')).toBe(1);
    for (const id of ['screenWatcher', 'supervisor', 'subagents', 'popup', 'goal'] as StageId[]) expect(stagePriority(id)).toBe(2);
  });

  it('defaults to two calls in flight', () => {
    expect(DEFAULT_AI_MAX_IN_FLIGHT).toBe(2);
  });
});

describe('createAiQueue', () => {
  it('never runs more than the cap at once', async () => {
    const started: string[] = [];
    const q = createAiQueue(2);
    const gates = ['a', 'b', 'c'].map((n) => gate(started, n));
    const runs = gates.map((g) => q.run('planner', g.task));
    expect(started).toEqual(['a', 'b']);
    expect(q.stats()).toEqual({ queued: 1, inFlight: 2 });
    gates[0].release();
    await flush();
    expect(started).toEqual(['a', 'b', 'c']);
    gates[1].release();
    gates[2].release();
    await expect(Promise.all(runs)).resolves.toEqual(['a', 'b', 'c']);
    expect(q.stats()).toEqual({ queued: 0, inFlight: 0 });
  });

  it('dispatches by tier, then FIFO within a tier', async () => {
    const started: string[] = [];
    const q = createAiQueue(1);
    const blocker = gate(started, 'blocker');
    void q.run('subagents', blocker.task);
    const order: Array<[StageId, string]> = [['supervisor', 'sup1'], ['planner', 'plan1'], ['screenWatcher', 'watch'], ['grounding', 'ground'], ['verdict', 'verdict'], ['executor', 'exec'], ['supervisor', 'sup2']];
    const gates = order.map(([stage, name]) => {
      const g = gate(started, name);
      void q.run(stage, g.task);
      return g;
    });
    expect(q.stats()).toEqual({ queued: order.length, inFlight: 1 });
    blocker.release();
    for (const g of gates) {
      await flush();
      g.release();
    }
    await flush();
    expect(started).toEqual(['blocker', 'ground', 'exec', 'plan1', 'verdict', 'sup1', 'watch', 'sup2']);
  });

  it('drops a call aborted while queued without running it', async () => {
    const started: string[] = [];
    const changes: number[] = [];
    const q = createAiQueue(1, (s) => changes.push(s.queued));
    const blocker = gate(started, 'blocker');
    void q.run('executor', blocker.task);
    const waiting = gate(started, 'waiting');
    const ctrl = new AbortController();
    const run = q.run('planner', waiting.task, ctrl.signal);
    expect(q.stats().queued).toBe(1);
    ctrl.abort();
    await expect(run).rejects.toBeInstanceOf(AiCancelled);
    expect(q.stats()).toEqual({ queued: 0, inFlight: 1 });
    blocker.release();
    await flush();
    expect(waiting.task).not.toHaveBeenCalled();
    expect(started).toEqual(['blocker']);
    expect(changes.at(-1)).toBe(0);
  });

  it('rejects an already-aborted call without queueing it', async () => {
    const q = createAiQueue(2);
    const task = vi.fn(async () => 'x');
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(q.run('executor', task, ctrl.signal)).rejects.toBeInstanceOf(AiCancelled);
    expect(task).not.toHaveBeenCalled();
    expect(q.stats()).toEqual({ queued: 0, inFlight: 0 });
  });

  it('drain drops only the queued calls of that stage', async () => {
    const started: string[] = [];
    const q = createAiQueue(1);
    const blocker = gate(started, 'blocker');
    void q.run('supervisor', blocker.task);
    const sup = gate(started, 'sup');
    const plan = gate(started, 'plan');
    const supRun = q.run('supervisor', sup.task);
    const planRun = q.run('planner', plan.task);
    expect(q.drain('supervisor')).toBe(1);
    await expect(supRun).rejects.toThrow(drainedText('supervisor'));
    expect(q.stats()).toEqual({ queued: 1, inFlight: 1 });
    blocker.release();
    await flush();
    plan.release();
    await expect(planRun).resolves.toBe('plan');
    expect(sup.task).not.toHaveBeenCalled();
  });

  it('frees the slot when a task rejects, and a raised cap starts waiting calls', async () => {
    const started: string[] = [];
    const q = createAiQueue(1);
    const failing = q.run('executor', async () => {
      throw new Error('boom');
    });
    const a = gate(started, 'a');
    const b = gate(started, 'b');
    const ra = q.run('planner', a.task);
    const rb = q.run('planner', b.task);
    await expect(failing).rejects.toThrow('boom');
    await flush();
    expect(started).toEqual(['a']);
    q.setLimit(2);
    expect(started).toEqual(['a', 'b']);
    a.release();
    b.release();
    await expect(Promise.all([ra, rb])).resolves.toEqual(['a', 'b']);
  });
});
