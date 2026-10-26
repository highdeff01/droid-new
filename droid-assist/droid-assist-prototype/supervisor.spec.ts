import { describe, expect, it, vi } from 'vitest';
import type { WorkflowStep } from './types.js';
import { AiError, type AskRequest } from './ai.js';
import { applyFixes, executorBusy, habitPatterns, isConfident, parseReview, reviewRun, staleFixes, supervisorDigest, type SupervisorInput } from './supervisor.js';

const step = (id: string, patch: Partial<WorkflowStep> = {}): WorkflowStep => ({ id, name: `Step ${id}`, action: 'click', x: 0.1, y: 0.1, status: 'pending', ...patch });

const input = (steps: WorkflowStep[]): SupervisorInput => ({
  goal: 'open the files app',
  steps,
  log: [
    { id: 'l1', time: 1, source: 'Popup watcher', message: 'New content appeared at (40%, 30%)', tone: 'warn' },
    { id: 'l2', time: 1, source: 'You', message: 'clicked', tone: 'info' },
  ],
  timeline: [{ id: 't1', time: 1, step: 'Step a', kind: 'verdict', text: 'FAILED · avoid: taskbar', thinking: null }],
  frames: [],
  sync: { level: 'red', detail: 'target not found' },
  progress: { done: 2, manual: 1 },
});

describe('supervisorDigest', () => {
  it('consolidates plan, drift, progress, agent outputs and thinking', () => {
    const text = supervisorDigest(input([step('a', { status: 'failed', drift: 0.2 })]));
    expect(text).toContain('Goal: open the files app');
    expect(text).toContain('1. click "Step a" at (10.0%, 10.0%) — failed, drift 0.200');
    expect(text).toContain('Drift monitor sync: red — target not found');
    expect(text).toContain('Progress tracker: 2 verified step(s), 1 manual');
    expect(text).toContain('[Popup watcher] New content appeared');
    expect(text).not.toContain('[You]');
    expect(text).toContain('[verdict] Step a: FAILED · avoid: taskbar');
  });
});

describe('parseReview', () => {
  const steps = [step('a'), step('b')];

  it('reads fixes by 1-based step number and habits; drops fixes for unknown steps', () => {
    const r = parseReview(JSON.stringify({ plan_ok: false, assessment: 'Step 2 target moved', confidence: 0.85, step_fixes: [{ step: 2, x: 0.6, y: 0.4, target: 'OK button', reason: 'moved' }, { step: 9, x: 0.1, y: 0.1 }], habits: [{ kind: 'avoid', pattern: 'clicking the taskbar' }, { kind: 'bogus', pattern: 'x' }] }), 'hmm', steps, 5);
    expect(r).toMatchObject({ time: 5, planOk: false, confidence: 0.85, thinking: 'hmm' });
    expect(r.stepFixes).toEqual([{ stepId: 'b', index: 2, target: 'OK button', x: 0.6, y: 0.4, reason: 'moved' }]);
    expect(r.habits).toEqual([{ kind: 'avoid', pattern: 'clicking the taskbar' }]);
  });

  it('treats a missing confidence as 0 and never invents an assessment', () => {
    expect(parseReview('{"plan_ok":true,"assessment":"fine"}', null, steps).confidence).toBe(0);
    expect(() => parseReview('{"plan_ok":true}', null, steps)).toThrow(AiError);
  });
});

describe('isConfident', () => {
  const base = { time: 0, planOk: false, assessment: 'x', thinking: null, habits: [] };
  it('applies only confident reviews that suggest something', () => {
    const fix = { stepId: 'a', index: 1, x: 0.5, y: 0.5, reason: '' };
    expect(isConfident({ ...base, confidence: 0.9, stepFixes: [fix] })).toBe(true);
    expect(isConfident({ ...base, confidence: 0.5, stepFixes: [fix] })).toBe(false);
    expect(isConfident({ ...base, confidence: 0.9, stepFixes: [] })).toBe(false);
  });
});

describe('applyFixes', () => {
  it('moves the target, drops the stale drift correction and re-queues the step', () => {
    const [a, b] = applyFixes([step('a', { status: 'failed', correctedX: 0.2, correctedY: 0.2, drift: 0.3 }), step('b', { status: 'done' })], [{ stepId: 'a', index: 1, x: 0.7, y: 0.3, target: 'Save', reason: '' }]);
    expect(a).toMatchObject({ x: 0.7, y: 0.3, target: 'Save', status: 'pending', correctedX: undefined, drift: undefined });
    expect(b.status).toBe('done');
  });
});

describe('habitPatterns', () => {
  it('turns habit updates into learned patterns for the goal', () => {
    expect(habitPatterns([{ kind: 'add', pattern: 'wait for the window' }], 'open notepad', 3)[0]).toMatchObject({ kind: 'add', pattern: 'wait for the window', context: 'open notepad', time: 3 });
  });
});

describe('staleFixes', () => {
  it('returns fixes the executor has not completed within the window', () => {
    const steps = [step('a'), step('b', { status: 'done' })];
    const pending = [{ stepId: 'a', appliedAt: 0 }, { stepId: 'b', appliedAt: 0 }, { stepId: 'gone', appliedAt: 0 }];
    expect(staleFixes(pending, steps, 1000, 5000)).toEqual([]);
    expect(staleFixes(pending, steps, 6000, 5000)).toEqual([{ stepId: 'a', appliedAt: 0 }]);
  });
});

describe('executorBusy', () => {
  it('is busy while auto act, replay or recording runs or a step is running', () => {
    const idle = { autoBusy: false, replaying: false, recording: false, steps: [step('a')] };
    expect(executorBusy(idle)).toBe(false);
    expect(executorBusy({ ...idle, replaying: true })).toBe(true);
    expect(executorBusy({ ...idle, steps: [step('a', { status: 'running' })] })).toBe(true);
  });
});

describe('reviewRun', () => {
  it('asks one structured JSON question with the newest frames attached', async () => {
    const frame = (id: number) => ({ id, time: 0, url: 'data:image/jpeg;base64,AA', data: {} as ImageData, srcW: 1, srcH: 1, source: 'demo' as const });
    const ask = vi.fn(async (_req: AskRequest) => ({ content: '{"plan_ok":true,"assessment":"on track","confidence":0.9}', thinking: null }));
    const r = await reviewRun(ask, { ...input([step('a')]), frames: [frame(4), frame(3), frame(2), frame(1)] });
    expect(r.assessment).toBe('on track');
    const req = ask.mock.calls[0][0];
    expect(req).toMatchObject({ json: true });
    expect(req.frame?.id).toBe(4);
    expect(req.frames?.map((f) => f.id)).toEqual([3, 2]);
    expect(req.prompt).toContain('is the current plan and coordinate set still correct');
  });

  it('propagates an endpoint failure instead of producing a review', async () => {
    const ask = vi.fn(async () => { throw new AiError('AI endpoint unreachable'); });
    await expect(reviewRun(ask, input([step('a')]))).rejects.toThrow('unreachable');
  });
});
