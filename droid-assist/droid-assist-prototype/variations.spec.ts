import { describe, expect, it } from 'vitest';
import {
  applyStepResult,
  createVariation,
  forgetPortfolio,
  mergeSteps,
  nextRunnable,
  pauseVariation,
  reattributePortfolio,
  removeVariation,
  resumeVariation,
  updateVariation,
  variationActor,
} from './variations.js';
import type { PortfolioEntry, PortfolioSource } from './portfolio.js';
import type { Frame, WorkflowStep } from './types.js';

const step = (id: string, over: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id,
  name: 'Click button',
  action: 'click',
  x: 0.5,
  y: 0.5,
  target: 'Button',
  status: 'pending',
  ...over,
});

const pfEntry = (actor: string, id: string): PortfolioEntry => ({
  id,
  actor,
  kind: 'note',
  text: 'note text',
  time: 1,
  source: { operation: 'x', opId: null },
});

describe('variation isolation', () => {
  it('createVariation copies steps so mutating the source array or a source step does not change the variation', () => {
    const source = [step('a'), step('b')];
    const v = createVariation('Save doc', source, 'superseded', 100);
    source[0].status = 'failed';
    source.push(step('c'));
    expect(v.steps).toHaveLength(2);
    expect(v.steps[0].status).toBe('pending');
  });

  it('createVariation drops each step\'s refFrame', () => {
    const v = createVariation('Save doc', [step('a', { refFrame: {} as Frame })], 'superseded', 1);
    expect(v.steps[0].refFrame).toBeUndefined();
  });

  it('createVariation turns a running step into pending', () => {
    const v = createVariation('Save doc', [step('a', { status: 'running' })], 'superseded', 1);
    expect(v.steps[0].status).toBe('pending');
  });

  it('updateVariation changes only the named variation and returns siblings by the same reference', () => {
    const a = createVariation('A', [step('a1')], 'r', 1);
    const b = createVariation('B', [step('b1')], 'r', 1);
    const result = updateVariation([a, b], a.id, (v) => pauseVariation(v, 'paused for test', 2));
    expect(result[0]).toMatchObject({ id: a.id, status: 'paused', reason: 'paused for test' });
    expect(result[1]).toBe(b);
  });

  it('applying a step result to one variation via updateVariation leaves the other variation\'s steps untouched', () => {
    const a = createVariation('A', [step('a1')], 'r', 1);
    const b = createVariation('B', [step('b1')], 'r', 1);
    const result = updateVariation([a, b], a.id, (v) => applyStepResult(v, 0, true, 'ok', 2));
    expect(result[0].steps[0].status).toBe('done');
    expect(result[1].steps).toBe(b.steps);
  });

  it('nextRunnable picks the running variation updated longest ago that still has a pending step, skipping paused and done', () => {
    const stale = createVariation('Stale', [step('s1')], 'r', 100);
    const fresh = createVariation('Fresh', [step('s2')], 'r', 200);
    const paused = pauseVariation(createVariation('Paused', [step('s3')], 'r', 50), 'held', 50);
    const done = applyStepResult(createVariation('Done', [step('s4')], 'r', 50), 0, true, 'ok', 50);
    const picked = nextRunnable([fresh, paused, done, stale]);
    expect(picked?.id).toBe(stale.id);
  });

  it('nextRunnable returns null when no running variation has a pending step', () => {
    const done = applyStepResult(createVariation('Done', [step('s1')], 'r', 1), 0, true, 'ok', 2);
    expect(nextRunnable([done])).toBeNull();
  });

  it('applyStepResult(ok=false) pauses the variation with a reason naming the failed step', () => {
    const v = createVariation('A', [step('s1', { name: 'Click Save' })], 'r', 1);
    const result = applyStepResult(v, 0, false, 'button not found', 2);
    expect(result.status).toBe('paused');
    expect(result.reason).toContain('Click Save');
    expect(result.reason).toContain('button not found');
  });

  it('applyStepResult marks the variation done when the last pending step succeeds', () => {
    const v = createVariation('A', [step('s1'), step('s2', { status: 'done' })], 'r', 1);
    const result = applyStepResult(v, 0, true, 'ok', 2);
    expect(result.status).toBe('done');
  });

  it('resumeVariation turns failed steps pending and sets status running', () => {
    const v = applyStepResult(createVariation('A', [step('s1')], 'r', 1), 0, false, 'oops', 2);
    const resumed = resumeVariation(v, 3);
    expect(resumed.status).toBe('running');
    expect(resumed.steps[0].status).toBe('pending');
  });

  it('reattributePortfolio changes only the entries belonging to the named variation', () => {
    const v = createVariation('A', [], 'r', 1);
    const other = createVariation('B', [], 'r', 1);
    const entries: PortfolioEntry[] = [pfEntry(variationActor(v.id), 'e1'), pfEntry(variationActor(other.id), 'e2'), pfEntry('coords', 'e3')];
    const newSource: PortfolioSource = { operation: 'Main project', opId: 'main_1' };
    const result = reattributePortfolio(entries, v.id, newSource);
    expect(result[0].source).toEqual(newSource);
    expect(result[1]).toBe(entries[1]);
    expect(result[2]).toBe(entries[2]);
  });

  it('forgetPortfolio drops only the named variation\'s entries, leaving other actors (including another variation\'s) unchanged', () => {
    const v = createVariation('A', [], 'r', 1);
    const other = createVariation('B', [], 'r', 1);
    const entries: PortfolioEntry[] = [pfEntry(variationActor(v.id), 'e1'), pfEntry(variationActor(other.id), 'e2'), pfEntry('coords', 'e3')];
    const result = forgetPortfolio(entries, v.id);
    expect(result).toEqual([entries[1], entries[2]]);
  });
});

describe('merge', () => {
  it('mergeSteps keeps main steps first, in order, then appends only variation steps not already in main', () => {
    const main = [step('m1', { action: 'click', target: 'Save' }), step('m2', { action: 'click', target: 'Close' })];
    const variation = [step('v1', { action: 'click', target: 'Save' }), step('v2', { action: 'click', target: 'Export' })];
    const result = mergeSteps(main, variation);
    expect(result).toEqual([main[0], main[1], variation[1]]);
  });

  it('gives a fresh id to an appended step whose id collides with a main step id', () => {
    const main = [step('shared', { action: 'click', target: 'Save' })];
    const variation = [step('shared', { action: 'click', target: 'Export' })];
    const result = mergeSteps(main, variation);
    expect(result[1].id).not.toBe('shared');
    expect(result[1]).toMatchObject({ action: 'click', target: 'Export' });
  });

  it('returns main unchanged when the variation adds nothing new', () => {
    const main = [step('m1', { action: 'click', target: 'Save' })];
    const variation = [step('v1', { action: 'click', target: 'Save' })];
    expect(mergeSteps(main, variation)).toEqual(main);
  });

  it('reattributePortfolio moves the variation\'s entries\' source to the given main source', () => {
    const v = createVariation('A', [], 'r', 1);
    const entries: PortfolioEntry[] = [pfEntry(variationActor(v.id), 'e1')];
    const mainSource: PortfolioSource = { operation: 'Main goal', opId: 'main_op' };
    const result = reattributePortfolio(entries, v.id, mainSource);
    expect(result[0].source).toEqual(mainSource);
  });
});

describe('discard', () => {
  it('removeVariation drops only the named id', () => {
    const a = createVariation('A', [], 'r', 1);
    const b = createVariation('B', [], 'r', 1);
    expect(removeVariation([a, b], a.id)).toEqual([b]);
  });

  it('forgetPortfolio drops only that variation\'s portfolio entries', () => {
    const v = createVariation('A', [], 'r', 1);
    const other = createVariation('B', [], 'r', 1);
    const entries: PortfolioEntry[] = [pfEntry(variationActor(v.id), 'e1'), pfEntry(variationActor(other.id), 'e2')];
    expect(forgetPortfolio(entries, v.id)).toEqual([entries[1]]);
  });
});
