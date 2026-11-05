import { describe, expect, it } from 'vitest';
import type { Habit, LogEntry, SavedCard, WorkflowStep } from './types.js';
import { RUN_SUMMARY_LIMIT, appendSummary, flowStats, mostFailedSteps, mostFailedTargets, runOutcome, runStats, runSummary, streaks, successOverTime, type RunSummary } from './run-stats.js';

const step = (id: string, status: WorkflowStep['status']): WorkflowStep => ({ id, name: id, action: 'click', x: 0.5, y: 0.5, status });
const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date(2026, 9, 20, 12).getTime();
const run = (n: number, outcome: RunSummary['outcome'], extra: Partial<RunSummary> = {}): RunSummary => ({
  id: `run_${n}`, time: T0 + n * 1000, session: 's1', goal: 'g', attempted: 2, succeeded: outcome === 'success' ? 2 : 1, durationMs: 1000, outcome, ...extra,
});
const habit = (target: string, attempts: number, successes: number): Habit => ({ id: target, target, context: 'App', attempts, successes, lastUsed: 0, lessons: [], pinned: false });
const line = (n: number, source: string, message: string, tone: LogEntry['tone']): LogEntry => ({ id: `l${n}`, time: n, source, message, tone });
const card = (id: string, name: string): SavedCard => ({ id, name, description: '', steps: [], savedAt: 0 });

describe('run summary recording', () => {
  it('records goal, attempted/succeeded steps, duration, outcome, session and flow', () => {
    const steps = [step('a', 'done'), step('b', 'drift'), step('c', 'failed'), step('d', 'pending')];
    const s = runSummary({ goal: '  open report ', steps, startedAt: 1000, dryRun: false, stopped: false, session: 'sess', flowId: 'card_1' }, 4500);
    expect(s).toMatchObject({ time: 4500, session: 'sess', goal: 'open report', attempted: 3, succeeded: 2, durationMs: 3500, outcome: 'failed', flowId: 'card_1' });
  });

  it('omits flowId for a run that is not a saved flow', () => {
    const s = runSummary({ goal: 'g', steps: [step('a', 'done')], startedAt: 0, dryRun: false, stopped: false, session: 's', flowId: null }, 10);
    expect(s.outcome).toBe('success');
    expect('flowId' in s).toBe(false);
  });

  it('classifies dry runs and stopped runs before success or failure', () => {
    const ok = [step('a', 'done')];
    expect(runOutcome(ok, { dryRun: true, stopped: false })).toBe('dry-run');
    expect(runOutcome(ok, { dryRun: false, stopped: true })).toBe('stopped');
    expect(runOutcome(ok, { dryRun: false, stopped: false })).toBe('success');
    expect(runOutcome([step('a', 'done'), step('b', 'failed')], { dryRun: false, stopped: false })).toBe('failed');
  });

  it('appends newest first and prunes the oldest beyond the limit', () => {
    let list: RunSummary[] = [];
    for (let i = 0; i < RUN_SUMMARY_LIMIT + 5; i++) list = appendSummary(list, run(i, 'success'));
    expect(list).toHaveLength(RUN_SUMMARY_LIMIT);
    expect(list[0].id).toBe(`run_${RUN_SUMMARY_LIMIT + 4}`);
    expect(list.at(-1)!.id).toBe('run_5');
  });
});

describe('aggregation', () => {
  it('buckets success rate per day, oldest first, excluding stopped and dry runs from the rate', () => {
    const runs = [run(0, 'success'), run(1, 'failed'), run(2, 'stopped'), run(3, 'dry-run'), run(4, 'success', { time: T0 + DAY })];
    const days = successOverTime(runs, 'day');
    expect(days.map((d) => [d.runs, d.successes, d.failures, d.rate])).toEqual([[4, 1, 1, 0.5], [1, 1, 0, 1]]);
  });

  it('buckets per session and gives 0 to a bucket with no decided run', () => {
    const sessions = successOverTime([run(0, 'success', { session: 'a' }), run(1, 'dry-run', { session: 'b' })], 'session');
    expect(sessions.map((s) => [s.key, s.rate])).toEqual([['a', 1], ['b', 0]]);
  });

  it('ranks the most-failed targets from habit failure counts', () => {
    const top = mostFailedTargets([habit('Save', 5, 4), habit('Close', 6, 1), habit('OK', 3, 3)]);
    expect(top.map((t) => [t.name, t.failures, t.attempts])).toEqual([['Close', 5, 6], ['Save', 1, 5]]);
  });

  it('ranks the most-failed steps from per-step run log lines naming known steps only', () => {
    const log = [
      line(1, 'Replay', 'Open menu: target not found', 'error'),
      line(2, 'Auto-Actor', 'Open menu: clicked', 'ok'),
      line(3, 'Self-test', 'Open menu: drift too large', 'error'),
      line(4, 'Replay', 'Type name: failed', 'error'),
      line(5, 'Safety', 'Panic: aborted', 'error'),
      line(6, 'Replay', 'AI unavailable — nothing executed: timeout', 'error'),
      line(7, 'Auto-Actor', 'Bridge unreachable: ECONNREFUSED', 'error'),
      line(8, 'Replay', 'Verification has no final screenshot: skipped', 'error'),
    ];
    expect(mostFailedSteps(log, ['Open menu', 'Type name', 'Panic']).map((s) => [s.name, s.failures, s.attempts])).toEqual([['Open menu', 2, 3], ['Type name', 1, 1]]);
  });

  it('reports runs, successes, average steps and duration per saved flow', () => {
    const runs = [run(0, 'success', { flowId: 'c1', attempted: 4, durationMs: 2000 }), run(1, 'failed', { flowId: 'c1', attempted: 2, durationMs: 4000 }), run(2, 'success')];
    expect(flowStats([card('c1', 'Report'), card('c2', 'Unused')], runs)).toEqual([
      { id: 'c1', name: 'Report', runs: 2, successes: 1, avgSteps: 3, avgDurationMs: 3000 },
      { id: 'c2', name: 'Unused', runs: 0, successes: 0, avgSteps: 0, avgDurationMs: 0 },
    ]);
  });

  it('computes current, best and daily streaks ignoring undecided runs', () => {
    const runs = [run(0, 'success'), run(1, 'success'), run(2, 'success'), run(3, 'failed'), run(4, 'success'), run(5, 'stopped'), run(6, 'success'), run(7, 'success', { time: T0 - DAY })];
    const s = streaks(runs, T0 + 10_000);
    expect(s.current).toEqual({ outcome: 'success', length: 2 });
    expect(s.bestSuccess).toBe(4);
    expect(s.days).toBe(2);
  });

  it('has no current streak and zero day streak without runs', () => {
    expect(streaks([], T0)).toEqual({ current: null, bestSuccess: 0, days: 0 });
  });

  it('runStats combines every view from the stores', () => {
    const stats = runStats({ runs: [run(0, 'success'), run(1, 'failed')], habits: [habit('X', 2, 1)], log: [line(1, 'Replay', 'a: no', 'error')], cards: [], steps: [step('a', 'failed')] }, 'day', T0);
    expect(stats.totals).toEqual({ runs: 2, successes: 1, failures: 1, rate: 0.5 });
    expect(stats.failedTargets).toHaveLength(1);
    expect(stats.failedSteps.map((s) => s.name)).toEqual(['a']);
    expect(stats.streaks.current).toEqual({ outcome: 'failed', length: 1 });
  });
});
