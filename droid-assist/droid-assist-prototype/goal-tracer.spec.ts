import { describe, expect, it } from 'vitest';
import { GOALS_KEY, currentObjective, dropGoal, loadGoals, nextGoals, queueGoal, runningProjects, saveGoals, settleGoal, startGoal } from './goal-tracer.js';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

describe('goal tracer', () => {
  it('traces a started goal as the active current objective, keyed by its trimmed text', () => {
    const goals = startGoal([], '  Export the report  ', 10);
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ text: 'Export the report', state: 'active', time: 10, updated: 10 });
    expect(currentObjective(goals)?.text).toBe('Export the report');
    expect(runningProjects(goals)).toEqual(['Export the report']);
  });

  it('ignores a blank goal', () => {
    expect(startGoal([], '   ')).toEqual([]);
    expect(queueGoal([], '')).toEqual([]);
  });

  it('settles a goal achieved or failed without duplicating its record', () => {
    let goals = startGoal([], 'Send mail', 1);
    goals = settleGoal(goals, 'Send mail', true, 5);
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ state: 'achieved', time: 1, updated: 5 });
    goals = settleGoal(startGoal(goals, 'Book flight', 6), 'Book flight', false, 7);
    expect(goals.find((g) => g.text === 'Book flight')?.state).toBe('failed');
    expect(currentObjective(goals)?.text).toBe('Book flight');
  });

  it('prefers an active goal over a more recently settled one', () => {
    let goals = startGoal([], 'A', 1);
    goals = settleGoal(startGoal(goals, 'B', 2), 'B', true, 3);
    expect(currentObjective(goals)?.text).toBe('A');
  });

  it('lists queued goals as next goals, oldest first, and keeps an existing goal state when re-queued', () => {
    let goals = queueGoal([], 'Second', 2);
    goals = queueGoal(goals, 'Third', 3);
    goals = startGoal(goals, 'First', 4);
    goals = queueGoal(goals, 'First', 5);
    expect(nextGoals(goals).map((g) => g.text)).toEqual(['Second', 'Third']);
    expect(goals.find((g) => g.text === 'First')?.state).toBe('active');
    expect(currentObjective(queueGoal([], 'Only queued'))).toBeNull();
    goals = startGoal(goals, 'Second', 6);
    expect(nextGoals(goals).map((g) => g.text)).toEqual(['Third']);
    expect(nextGoals(dropGoal(goals, nextGoals(goals)[0].id))).toEqual([]);
  });

  it('persists and reloads records, dropping invalid ones', () => {
    const store = memory();
    saveGoals(startGoal([], 'Persist me', 1), store);
    expect(loadGoals(store).map((g) => g.text)).toEqual(['Persist me']);
    store.data.set(GOALS_KEY, JSON.stringify([{ id: 'x', text: 'ok', state: 'bogus', time: 1, updated: 1 }, 'junk']));
    expect(loadGoals(store)).toEqual([]);
    store.data.set(GOALS_KEY, '{not json');
    expect(loadGoals(store)).toEqual([]);
import type { GoalCheck } from './assist-ai.js';
import {
  DEFAULT_GOAL_STALL,
  createGoal,
  goalBriefingLine,
  goalMemory,
  goalProgress,
  hydrateGoals,
  memoryLines,
  startGoal,
  trace,
  tracedCheck,
  tracerStatus,
  updateGoal,
  type GoalRecord,
  type TraceContext,
} from './goal-tracer.js';

const steps = (...ids: string[]) => ids.map((id) => ({ id, name: `Step ${id}` }));
const ctx = (now: number, stallLimit = DEFAULT_GOAL_STALL): TraceContext => ({ now, stallLimit });
const doneStep = (r: GoalRecord, stepId: string, now: number) => trace(r, { kind: 'step', stepId, name: `Step ${stepId}`, ok: true, executed: true, detail: '' }, ctx(now)).record;

describe('createGoal', () => {
  it('gives an active record with pending step traces and progress 0', () => {
    const g = createGoal({ goal: '  open report  ', source: 'user', steps: steps('s1', 's2') }, 1000);
    expect(g).toMatchObject({
      goal: 'open report',
      source: 'user',
      createdAt: 1000,
      updatedAt: 1000,
      status: 'active',
      stepIds: ['s1', 's2'],
      obstacles: [],
      retries: 0,
      workflowId: null,
      runIds: [],
      progress: 0,
      stalls: 0,
      checkedProgress: 0,
      lastCheck: null,
    });
    expect(g.steps).toEqual({
      s1: { name: 'Step s1', state: 'pending', at: 1000 },
      s2: { name: 'Step s2', state: 'pending', at: 1000 },
    });
    expect(typeof g.id).toBe('string');
  });

  it('defaults workflowId to null when not given', () => {
    const g = createGoal({ goal: 'g', source: 'ai', steps: [] }, 1000);
    expect(g.workflowId).toBeNull();
  });
});

describe('trace', () => {
  it('leaves the record unchanged for an ok but not executed (dry-run) step', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const out = trace(g0, { kind: 'step', stepId: 's1', name: 'Step s1', ok: true, executed: false, detail: '' }, ctx(2000));
    expect(out.record).toBe(g0);
    expect(out.notices).toEqual([]);
  });

  it('marks a step done with doneAt, raises step-done and resets stalls', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1', 's2') }, 1000);
    const failed = trace(g0, { kind: 'step', stepId: 's1', name: 'Step s1', ok: false, executed: true, detail: 'x' }, ctx(2000, 5)).record;
    expect(failed.stalls).toBe(1);
    const out = trace(failed, { kind: 'step', stepId: 's2', name: 'Step s2', ok: true, executed: true, detail: '' }, ctx(3000, 5));
    expect(out.record.steps.s2).toMatchObject({ state: 'done', doneAt: 3000 });
    expect(out.record.stalls).toBe(0);
    expect(out.record.updatedAt).toBe(3000);
    expect(out.notices).toEqual([{ kind: 'step-done', text: expect.stringContaining('Step "Step s2" done'), tone: 'ok' }]);
  });

  it('marks a step failed with failedAt and records a step obstacle', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const out = trace(g0, { kind: 'step', stepId: 's1', name: 'Step s1', ok: false, executed: true, detail: 'no button' }, ctx(2000, 5));
    expect(out.record.steps.s1).toMatchObject({ state: 'failed', failedAt: 2000 });
    expect(out.record.obstacles).toEqual([{ time: 2000, cause: 'step', text: '"Step s1" failed: no button' }]);
    expect(out.notices[0]).toMatchObject({ kind: 'step-failed', tone: 'error' });
  });

  it('raises a stalled notice once when stalls reach the limit, not again on the next failure', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1', 's2', 's3') }, 1000);
    const c = ctx(2000, 2);
    const r1 = trace(g0, { kind: 'step', stepId: 's1', name: 'Step s1', ok: false, executed: true, detail: 'x' }, c);
    expect(r1.record.stalls).toBe(1);
    expect(r1.notices.map((n) => n.kind)).toEqual(['step-failed']);
    const r2 = trace(r1.record, { kind: 'step', stepId: 's2', name: 'Step s2', ok: false, executed: true, detail: 'x' }, c);
    expect(r2.record.stalls).toBe(2);
    expect(r2.notices.map((n) => n.kind)).toEqual(['step-failed', 'stalled']);
    const r3 = trace(r2.record, { kind: 'step', stepId: 's3', name: 'Step s3', ok: false, executed: true, detail: 'x' }, c);
    expect(r3.record.stalls).toBe(3);
    expect(r3.notices.map((n) => n.kind)).toEqual(['step-failed']);
  });

  it('upgrades a done step to verified on a successful verdict', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const done = doneStep(g0, 's1', 2000);
    const out = trace(done, { kind: 'verdict', stepId: 's1', name: 'Step s1', success: true }, ctx(3000));
    expect(out.record.steps.s1).toMatchObject({ state: 'verified', verifiedAt: 3000 });
    expect(out.record.progress).toBe(100);
  });

  it('marks the step failed and raises off-path with a verdict obstacle on a failing verdict', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const done = doneStep(g0, 's1', 2000);
    const out = trace(done, { kind: 'verdict', stepId: 's1', name: 'Step s1', success: false }, ctx(3000, 5));
    expect(out.record.steps.s1).toMatchObject({ state: 'failed', failedAt: 3000 });
    expect(out.record.obstacles).toEqual([{ time: 3000, cause: 'verdict', text: 'screenshot verdict says "Step s1" did not work' }]);
    expect(out.notices[0]).toMatchObject({ kind: 'off-path', tone: 'warn' });
  });

  it('adds count to retries', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const out = trace(g0, { kind: 'retries', count: 3 }, ctx(2000));
    expect(out.record.retries).toBe(3);
  });

  it('records a deviation obstacle and notifies off-path', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const out = trace(g0, { kind: 'deviation', cause: 'drift', text: 'cursor drifted off target' }, ctx(2000));
    expect(out.record.obstacles).toEqual([{ time: 2000, cause: 'drift', text: 'cursor drifted off target' }]);
    expect(out.notices).toEqual([{ kind: 'off-path', text: 'Off-path from "g" — cursor drifted off target', tone: 'warn' }]);
  });

  it('records an identical repeat deviation once and notifies once', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const first = trace(g0, { kind: 'deviation', cause: 'drift', text: 'cursor drifted off target' }, ctx(2000));
    const second = trace(first.record, { kind: 'deviation', cause: 'drift', text: 'cursor drifted off target' }, ctx(3000));
    expect(second.record).toBe(first.record);
    expect(second.notices).toEqual([]);
    expect(first.record.obstacles).toHaveLength(1);
  });

  it('check complete marks the goal completed with a complete notice', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const out = trace(g0, { kind: 'check', complete: true, progress: true, reason: 'report open' }, ctx(2000));
    expect(out.record.status).toBe('completed');
    expect(out.notices).toEqual([{ kind: 'complete', text: 'Goal "g" verifiably complete — report open', tone: 'ok' }]);
  });

  it('check incomplete with no progress records a no-progress obstacle and a stall', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const out = trace(g0, { kind: 'check', complete: false, progress: false, reason: 'still on home screen' }, ctx(2000, 5));
    expect(out.record.stalls).toBe(1);
    expect(out.record.obstacles).toEqual([{ time: 2000, cause: 'no-progress', text: 'goal check found no progress — still on home screen' }]);
    expect(out.record.lastCheck).toEqual({ time: 2000, complete: false, progress: false, reason: 'still on home screen' });
    expect(out.notices[0]).toMatchObject({ kind: 'off-path' });
  });

  it('check incomplete but traced progress since the last check counts as progress', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const done = doneStep(g0, 's1', 2000);
    expect(done.progress).toBe(100);
    expect(done.checkedProgress).toBe(0);
    const out = trace(done, { kind: 'check', complete: false, progress: false, reason: 'not sure yet' }, ctx(3000, 5));
    expect(out.record.stalls).toBe(0);
    expect(out.record.lastCheck?.progress).toBe(true);
    expect(out.record.checkedProgress).toBe(100);
    expect(out.notices).toEqual([]);
  });

  it('plan append keeps existing traces and adds new ids', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const done = doneStep(g0, 's1', 2000);
    const out = trace(done, { kind: 'plan', steps: [...steps('s1'), ...steps('s2')], append: true }, ctx(3000));
    expect(out.record.stepIds).toEqual(['s1', 's2']);
    expect(out.record.steps.s1).toMatchObject({ state: 'done' });
    expect(out.record.steps.s2).toMatchObject({ state: 'pending' });
  });

  it('plan without append replaces the existing steps', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const done = doneStep(g0, 's1', 2000);
    const out = trace(done, { kind: 'plan', steps: steps('s2', 's3'), append: false }, ctx(3000));
    expect(out.record.stepIds).toEqual(['s2', 's3']);
    expect(out.record.steps.s1).toBeUndefined();
    expect(out.record.status).toBe('active');
  });

  it('run links runId first and flowId as the workflowId', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const out = trace(g0, { kind: 'run', runId: 'run_1', outcome: 'dry-run', flowId: 'card_1' }, ctx(2000));
    expect(out.record.runIds).toEqual(['run_1']);
    expect(out.record.workflowId).toBe('card_1');
  });

  it('run stopped marks the goal abandoned with an ended notice', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const out = trace(g0, { kind: 'run', runId: 'run_1', outcome: 'stopped', flowId: null }, ctx(2000));
    expect(out.record.status).toBe('abandoned');
    expect(out.notices).toEqual([{ kind: 'ended', text: expect.stringContaining('abandoned'), tone: 'warn' }]);
  });

  it('run failed marks the goal failed', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const out = trace(g0, { kind: 'run', runId: 'run_1', outcome: 'failed', flowId: null }, ctx(2000));
    expect(out.record.status).toBe('failed');
  });

  it('run success at 100% progress completes the goal with a complete notice', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const done = doneStep(g0, 's1', 2000);
    const out = trace(done, { kind: 'run', runId: 'run_1', outcome: 'success', flowId: null }, ctx(3000));
    expect(out.record.status).toBe('completed');
    expect(out.notices.some((n) => n.kind === 'complete')).toBe(true);
  });

  it('run success is marked failed when the last check said incomplete', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const done = doneStep(g0, 's1', 2000);
    const checked = trace(done, { kind: 'check', complete: false, progress: true, reason: 'not yet' }, ctx(2500)).record;
    const out = trace(checked, { kind: 'run', runId: 'run_1', outcome: 'success', flowId: null }, ctx(3000));
    expect(out.record.status).toBe('failed');
  });

  it('run dry-run keeps the current status', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const out = trace(g0, { kind: 'run', runId: 'run_1', outcome: 'dry-run', flowId: null }, ctx(2000));
    expect(out.record.status).toBe('active');
  });

  it('stamps updatedAt with ctx.now when the record changes', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const out = trace(g0, { kind: 'retries', count: 1 }, ctx(5000));
    expect(out.record.updatedAt).toBe(5000);
  });
});

describe('goalProgress', () => {
  it('rounds verified/done steps over total steps to a percentage', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1', 's2', 's3') }, 1000);
    const done = doneStep(g0, 's1', 2000);
    expect(goalProgress(done)).toBe(33);
  });

  it('is 0 with no steps', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: [] }, 1000);
    expect(goalProgress(g0)).toBe(0);
  });
});

describe('tracedCheck', () => {
  it('counts progress when traced progress grew since the last check and appends traced counts to the reason', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const done = doneStep(g0, 's1', 2000);
    const check: GoalCheck = { thinking: null, complete: false, progress: false, reason: 'not sure' };
    const out = tracedCheck(done, check);
    expect(out.progress).toBe(true);
    expect(out.reason).toBe('not sure · traced 1/1 verified (100%)');
  });

  it('keeps the model progress true when it already said progress', () => {
    const g0 = createGoal({ goal: 'g', source: 'user', steps: steps('s1') }, 1000);
    const check: GoalCheck = { thinking: null, complete: false, progress: true, reason: 'moved forward' };
    expect(tracedCheck(g0, check).progress).toBe(true);
  });
});

describe('startGoal', () => {
  it('pauses the other active goal and puts the new one first, without overwriting it', () => {
    const g1 = createGoal({ goal: 'first', source: 'user', steps: steps('a') }, 1000);
    const g2 = createGoal({ goal: 'second', source: 'user', steps: steps('b') }, 2000);
    const list = startGoal([g1], g2);
    expect(list[0]).toBe(g2);
    expect(list[1]).toEqual({ ...g1, status: 'paused' });
  });

  it('leaves an already-paused goal as is', () => {
    const g1 = { ...createGoal({ goal: 'first', source: 'user', steps: steps('a') }, 1000), status: 'paused' as const };
    const g2 = createGoal({ goal: 'second', source: 'user', steps: steps('b') }, 2000);
    expect(startGoal([g1], g2)[1]).toBe(g1);
  });

  it('updateGoal touches only the given id', () => {
    const g1 = createGoal({ goal: 'first', source: 'user', steps: steps('a') }, 1000);
    const g2 = createGoal({ goal: 'second', source: 'user', steps: steps('b') }, 2000);
    const list = updateGoal([g1, g2], g1.id, (g) => ({ ...g, retries: g.retries + 1 }));
    expect(list[0].retries).toBe(1);
    expect(list[1]).toBe(g2);
  });

  it('hydrateGoals turns an active goal into paused and leaves others', () => {
    const active = createGoal({ goal: 'active', source: 'user', steps: steps('a') }, 1000);
    const completed = { ...createGoal({ goal: 'done', source: 'user', steps: steps('b') }, 2000), status: 'completed' as const };
    const [a, c] = hydrateGoals([active, completed]);
    expect(a.status).toBe('paused');
    expect(c).toBe(completed);
  });
});

describe('goalMemory', () => {
  const g = (over: Partial<GoalRecord>): GoalRecord => ({ ...createGoal({ goal: over.goal ?? 'g', source: 'user', steps: [] }, 1000), ...over });

  it('keeps only completed/failed/abandoned goals in recent, newest first', () => {
    const active = g({ goal: 'active one', status: 'active', updatedAt: 500 });
    const done1 = g({ goal: 'open report', status: 'completed', updatedAt: 3000 });
    const done2 = g({ goal: 'close app', status: 'failed', updatedAt: 4000 });
    const mem = goalMemory([active, done1, done2], 'anything');
    expect(mem.recent.map((r) => r.goal)).toEqual(['close app', 'open report']);
  });

  it('marks completed goals sharing a 3+ char word with the text as important', () => {
    const related = g({ goal: 'open the report screen', status: 'completed', updatedAt: 1000 });
    const unrelated = g({ goal: 'close settings', status: 'completed', updatedAt: 2000 });
    const mem = goalMemory([related, unrelated], 'please open the report again');
    expect(mem.important.map((r) => r.goal)).toEqual(['open the report screen']);
  });

  it('marks failed/abandoned related goals as blacklisted', () => {
    const failed = g({ goal: 'open the report screen', status: 'failed', updatedAt: 1000 });
    const abandoned = g({ goal: 'open the report screen', status: 'abandoned', updatedAt: 2000 });
    const mem = goalMemory([failed, abandoned], 'open the report again');
    expect(mem.blacklisted.map((r) => r.goal)).toEqual(['open the report screen', 'open the report screen']);
  });

  it('memoryLines yields lines starting Recent goal / Important / Blacklisted', () => {
    const recent = g({ goal: 'open report', status: 'completed', progress: 100 });
    const important = { ...g({ goal: 'open report', status: 'completed' }), stepIds: ['a'], retries: 2 };
    const blacklisted = { ...g({ goal: 'open report', status: 'failed' }), obstacles: [{ time: 1, cause: 'step' as const, text: 'could not find button' }] };
    const lines = memoryLines({ recent: [recent], important: [important], blacklisted: [blacklisted] });
    expect(lines[0]).toMatch(/^Recent goal: /);
    expect(lines[1]).toMatch(/^Important/);
    expect(lines[2]).toMatch(/^Blacklisted/);
  });
});

describe('tracerStatus', () => {
  it('goalBriefingLine reports goal progress with the percent', () => {
    const g0 = createGoal({ goal: 'open report', source: 'user', steps: steps('s1', 's2') }, 1000);
    const done = doneStep(g0, 's1', 2000);
    const line = goalBriefingLine(done);
    expect(line).toContain('Goal progress:');
    expect(line).toContain('50%');
  });

  it('is off when the tracer is off', () => {
    const g0 = createGoal({ goal: 'open report', source: 'user', steps: steps('s1') }, 1000);
    expect(tracerStatus(g0, false)).toBe('off');
  });

  it('is idle with no active goal', () => {
    expect(tracerStatus(null, true)).toBe('idle — no active goal');
  });

  it('mentions the goal text when tracing', () => {
    const g0 = createGoal({ goal: 'open report', source: 'user', steps: steps('s1') }, 1000);
    expect(tracerStatus(g0, true)).toContain('open report');
  });
});
