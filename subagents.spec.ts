import { describe, expect, it, vi } from 'vitest';
import { isTestGoal, listSections, parseTestSpec, planSubagents, reportPatterns, runSubagents, sliceBudget, summaryText, type SubagentOutcome, type SubagentResult, type SubagentTask } from './subagents.js';
import { AiError } from './ai.js';

const outcome = (status: SubagentOutcome['status'], extra: Partial<SubagentOutcome> = {}): SubagentOutcome => ({ status, message: status, dry: false, shots: [], thinking: [], ...extra });

describe('subagent planning', () => {
  it('gives one subagent per link', () => {
    const tasks = planSubagents('link', ['Files', 'Notes', 'Game'], 9);
    expect(tasks.map((t) => [t.label, t.target, t.budget])).toEqual([['Files', 'Files', 3], ['Notes', 'Notes', 3], ['Game', 'Game', 3]]);
    expect(tasks[1].goal).toMatch(/"Notes"/);
  });

  it('gives one subagent per route segment', () => {
    const tasks = planSubagents('route', ['Home', 'Cart', 'Checkout', 'Pay'], 50);
    expect(tasks.map((t) => t.label)).toEqual(['Home', 'Home → Cart', 'Cart → Checkout', 'Checkout → Pay']);
    expect(tasks[2].goal).toMatch(/from "Cart" to "Checkout"/);
  });

  it('slices the budget without exceeding the total', () => {
    expect(sliceBudget(5, 3)).toEqual([2, 2, 1]);
    expect(sliceBudget(2, 3)).toEqual([1, 1, 0]);
    expect(sliceBudget(7, 0)).toEqual([]);
  });

  it('parses /test specs and recognises test goals', () => {
    expect(parseTestSpec('links Files, Notes ,Calc')).toMatchObject({ kind: 'link', items: ['Files', 'Notes', 'Calc'] });
    expect(parseTestSpec('route Cart > Checkout -> Pay')).toMatchObject({ kind: 'route', items: ['Cart', 'Checkout', 'Pay'] });
    expect(parseTestSpec('verify the checkout flow end-to-end')).toMatchObject({ kind: 'route', items: [] });
    expect(isTestGoal('verify every nav item opens its section')).toBe(true);
    expect(isTestGoal('open notepad')).toBe(false);
  });
});

describe('runSubagents', () => {
  const tasks: SubagentTask[] = planSubagents('link', ['A', 'B', 'C'], 3);

  it('runs subagents one at a time', async () => {
    let live = 0;
    let peak = 0;
    const run = async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 10));
      live--;
      return outcome('pass');
    };
    const results = await runSubagents(tasks, run, () => false);
    expect(peak).toBe(1);
    expect(results.map((r) => r.status)).toEqual(['pass', 'pass', 'pass']);
  });

  it('aborts the remaining subagents once stopped', async () => {
    let stopped = false;
    const run = vi.fn(async () => {
      stopped = true;
      return outcome('aborted');
    });
    const results = await runSubagents(tasks, run, () => stopped);
    expect(run).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.status)).toEqual(['aborted', 'aborted', 'aborted']);
  });

  it('skips a slice with no budget and fails a slice that throws', async () => {
    const run = vi.fn(async (t: SubagentTask) => {
      if (t.label === 'A') throw new AiError('AI endpoint unreachable');
      return outcome('pass');
    });
    const results = await runSubagents(planSubagents('link', ['A', 'B', 'C'], 2), run, () => false);
    expect(results.map((r) => r.status)).toEqual(['fail', 'pass', 'skipped']);
    expect(results[0].message).toMatch(/unreachable/);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('report', () => {
  it('summarises and feeds avoid/add patterns, ignoring aborted slices', () => {
    const [a, b, c] = planSubagents('link', ['A', 'B', 'C'], 3);
    const results: SubagentResult[] = [{ ...a, ...outcome('pass', { add: 'wait for the menu' }) }, { ...b, ...outcome('pass') }, { ...c, ...outcome('fail', { avoid: 'clicking the label edge' }) }];
    expect(summaryText(results)).toBe('2/3 passed · 1 failed · 0 aborted · 0 skipped');
    const patterns = reportPatterns(results, 'test nav');
    expect(patterns.filter((p) => p.kind === 'add').map((p) => p.pattern)).toContain('wait for the menu');
    expect(patterns.filter((p) => p.kind === 'avoid')).toHaveLength(2);
    expect(reportPatterns([{ ...a, ...outcome('aborted') }], 'x')).toEqual([]);
  });

  it('lists sections from the model and rejects an empty list', async () => {
    const ask = vi.fn(async () => ({ content: '{"items":["Files"," Notes ",3]}', thinking: 'two links' }));
    await expect(listSections(ask, null, { kind: 'link', items: [], goal: 'test links' })).resolves.toEqual({ items: ['Files', 'Notes'], thinking: 'two links' });
    const empty = vi.fn(async () => ({ content: '{"items":[]}', thinking: null }));
    await expect(listSections(empty, null, { kind: 'link', items: [], goal: 'x' })).rejects.toThrow(AiError);
  });
});

describe('runSubagentsCrew', () => {
  const tasks: SubagentTask[] = planSubagents('link', ['A', 'B', 'C'], 3);

  it('runs up to crew tasks at once and returns results in task order', async () => {
    let live = 0;
    let peak = 0;
    const deferred: Array<() => void> = [];
    const run = (task: SubagentTask) => new Promise<SubagentOutcome>((resolve) => {
      live++;
      peak = Math.max(peak, live);
      deferred.push(() => {
        live--;
        resolve(outcome('pass', { message: task.label }));
      });
    });
    const resultsPromise = runSubagents(tasks, run, () => false, undefined, 3);
    while (deferred.length < tasks.length) await Promise.resolve();
    deferred.forEach((release) => release());
    const results = await resultsPromise;
    expect(peak).toBe(3);
    expect(results.map((r) => r.label)).toEqual(['A', 'B', 'C']);
  });

  it('defaults to running one task at a time', async () => {
    let live = 0;
    let peak = 0;
    const run = async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return outcome('pass');
    };
    await runSubagents(tasks, run, () => false);
    expect(peak).toBe(1);
  });
});
