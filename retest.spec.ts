import { describe, expect, it, vi } from 'vitest';
import { parseSelection, refreshStep, retestSummary, retestText, retestedSteps, runRetest, selectSteps, type RetestDeps, type RetestStepResult } from './retest.js';
import type { WorkflowStep } from './types.js';
import type { InventoryElement } from './screen-inventory.js';

const step = (i: number, over: Partial<WorkflowStep> = {}): WorkflowStep => ({ id: `s${i}`, name: `Step ${i}`, action: 'click', target: `T${i}`, x: 0.1 * i, y: 0.5, status: 'pending', ...over });
const FLOW = [0, 1, 2, 3].map((i) => step(i));
const el = (name: string, x: number, state: InventoryElement['state'] = 'static'): InventoryElement => ({ id: name, name, known: true, kind: 'button', box: { x: x - 0.025, y: 0.475, w: 0.05, h: 0.05 }, cell: 'D6', mapCells: '', state });

describe('selectSteps', () => {
  it('runs selected steps in flow order, dropping duplicates and out-of-range indices', () => {
    expect(selectSteps(4, [3, 1, 1, 9, -1])).toEqual([1, 3]);
  });
  it('treats an empty selection, or one with nothing in range, as the whole flow', () => {
    expect(selectSteps(3, [])).toEqual([0, 1, 2]);
    expect(selectSteps(3, [7])).toEqual([0, 1, 2]);
    expect(selectSteps(0, [])).toEqual([]);
  });
});

describe('parseSelection', () => {
  it('reads 1-based step numbers and ranges as 0-based indices', () => {
    expect(parseSelection('2, 4-5 x')).toEqual([1, 3, 4]);
    expect(parseSelection('')).toEqual([]);
  });
});

describe('refreshStep', () => {
  it('re-points a moved target and reports the move as the obstacle', () => {
    const r = refreshStep(step(2), [el('T2', 0.6, 'moved')]);
    expect(r.step).toMatchObject({ x: 0.6, y: 0.5 });
    expect(r.obstacle).toContain('moved');
  });
  it('leaves a step whose target is where it was, or without inventory, untouched', () => {
    expect(refreshStep(step(2), [el('T2', 0.2)])).toEqual({ step: step(2), obstacle: null });
    expect(refreshStep(step(2), [])).toEqual({ step: step(2), obstacle: null });
  });
  it('reports a target missing from the screen for grounding', () => {
    expect(refreshStep(step(2), [el('Other', 0.9)]).obstacle).toContain('not on screen');
  });
});

describe('runRetest', () => {
  const deps = (results: Record<number, { ok: boolean; halt?: boolean; obstacle?: string }>): RetestDeps => ({
    prepare: (s) => ({ step: s, obstacle: s.id === 's1' ? 'popup appeared' : null }),
    perform: vi.fn(async (_s, i) => ({ ok: results[i]?.ok ?? true, executed: true, message: 'm', halt: results[i]?.halt, obstacle: results[i]?.obstacle })),
  });
  it('runs every step of the flow with per-step results and obstacles', async () => {
    const r = await runRetest(FLOW, [], deps({ 3: { ok: true, obstacle: 'closed ad' } }));
    expect(r.map((x) => x.index)).toEqual([0, 1, 2, 3]);
    expect(r[1].obstacle).toBe('popup appeared');
    expect(r[3].obstacle).toBe('closed ad');
    expect(r[0].obstacle).toBeNull();
    expect(retestSummary(r)).toMatchObject({ pass: true, passed: 4, failed: 0 });
  });
  it('runs only the selected steps in order', async () => {
    const d = deps({});
    const r = await runRetest(FLOW, [2, 0], d);
    expect(r.map((x) => x.stepId)).toEqual(['s0', 's2']);
    expect(d.perform).toHaveBeenCalledTimes(2);
  });
  it('stops at a halt and fails the summary', async () => {
    const r = await runRetest(FLOW, [], deps({ 1: { ok: false, halt: true } }));
    expect(r).toHaveLength(2);
    const s = retestSummary(r, 4);
    expect(s).toMatchObject({ pass: false, passed: 1, failed: 1, executed: 2, selected: 4 });
    expect(retestText(s)).toBe('FAIL — 1/4 step(s) passed, 2 not run');
  });
});

describe('retestSummary', () => {
  const res = (ok: boolean, executed = true): RetestStepResult => ({ index: 0, stepId: 's', name: 'n', target: 't', ok, executed, message: '', obstacle: null });
  it('passes only when every executed step passed', () => {
    expect(retestSummary([res(true), res(true)]).pass).toBe(true);
    expect(retestSummary([res(true), res(false)]).pass).toBe(false);
    expect(retestSummary([]).pass).toBe(false);
  });
});

describe('retestedSteps', () => {
  it('marks retested steps done or failed and leaves the rest', () => {
    const results: RetestStepResult[] = [{ index: 1, stepId: 's1', name: '', target: '', ok: false, executed: true, message: '', obstacle: null }];
    expect(retestedSteps(FLOW, results).map((s) => s.status)).toEqual(['pending', 'failed', 'pending', 'pending']);
  });
});
