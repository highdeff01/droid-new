import { describe, expect, it } from 'vitest';
import { createGoal, trace, DEFAULT_GOAL_STALL } from './goal-tracer.js';
import { attemptPath, operationView, type OperationAttempt, type OperationInput } from './current-operation.js';
import type { TrailPoint, WorkflowStep } from './types.js';

const NOW = 1_000_000;
const steps: WorkflowStep[] = [
  { id: 'a', name: 'Open menu', action: 'click', x: 0.1, y: 0.1, status: 'done' },
  { id: 'b', name: 'Click files icon', target: 'files icon', action: 'click', x: 0.4, y: 0.5, status: 'running' },
  { id: 'c', name: 'Type name', target: 'name field', action: 'type', text: 'x', x: 0.6, y: 0.2, status: 'pending' },
];
const record = (() => {
  const g = createGoal({ goal: 'Rename the file', source: 'user', steps }, NOW);
  const done = trace(g, { kind: 'step', stepId: 'a', name: 'Open menu', ok: true, executed: true, detail: '' }, { now: NOW, stallLimit: DEFAULT_GOAL_STALL }).record;
  return trace(done, { kind: 'verdict', stepId: 'a', name: 'Open menu', success: true }, { now: NOW, stallLimit: DEFAULT_GOAL_STALL }).record;
})();
const attempt = (over: Partial<OperationAttempt>): OperationAttempt => ({ id: 'x1', stepId: 'b', name: 'Click files icon', action: 'click', actor: 'Replay', intent: 'Moving to files icon because y.', from: { x: 0.1, y: 0.1 }, to: { x: 0.4, y: 0.5 }, start: 100, end: 200, ok: false, ...over });
const trail: TrailPoint[] = [{ x: 0.0, y: 0.0, t: 50 }, { x: 0.2, y: 0.3, t: 150 }, { x: 0.35, y: 0.45, t: 190 }, { x: 0.38, y: 0.5, t: 260 }, { x: 0.4, y: 0.5, t: 280, click: true }];
const input = (over: Partial<OperationInput> = {}): OperationInput => ({ steps, activeIndex: 1, attempts: [attempt({}), attempt({ id: 'x2', start: 250, end: undefined, ok: undefined })], trail, record, goal: 'typed goal', cursor: { x: 0.9, y: 0.9 }, ...over });

describe('attemptPath', () => {
  it('plans a straight line from the prior cursor to the target and takes the trail inside the attempt window', () => {
    expect(attemptPath(attempt({}), trail, NOW)).toMatchObject({ planned: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.5 }], actual: [{ x: 0.2, y: 0.3 }, { x: 0.35, y: 0.45 }] });
    expect(attemptPath(attempt({ from: null, end: undefined, start: 255 }), trail, 300).actual).toEqual([{ x: 0.38, y: 0.5 }, { x: 0.4, y: 0.5 }]);
    expect(attemptPath(attempt({ from: null }), trail, NOW).planned).toEqual([{ x: 0.4, y: 0.5 }]);
  });
});

describe('operationView', () => {
  it('shows the running step with its attempts, traced progress, attention, next step and main goal', () => {
    const v = operationView(input(), 300);
    expect(v.step?.id).toBe('b');
    expect(v.attempts).toHaveLength(2);
    expect(v.goal).toBe('Rename the file');
    expect(v.progress).toBe(record.progress);
    expect(v.verified).toBe(1);
    expect(v.total).toBe(3);
    expect(v.attention).toEqual({ x: 0.4, y: 0.5 });
    expect(v.next).toBe('type "name field"');
    expect(v.intent).toBe('Moving to files icon because y.');
  });

  it('with no running step falls back to the newest attempt, the goal input and the cursor', () => {
    const v = operationView(input({ activeIndex: null, record: null, attempts: [attempt({})] }), 300);
    expect(v.step?.id).toBe('b');
    expect(v.goal).toBe('typed goal');
    expect(v.progress).toBeNull();
    expect(v.attention).toEqual({ x: 0.9, y: 0.9 });
  });

  it('is empty when nothing ran', () => {
    const v = operationView(input({ activeIndex: null, attempts: [], cursor: null, record: null, goal: '' }), 300);
    expect(v).toMatchObject({ step: null, attempts: [], goal: '', attention: null, next: 'click "files icon"' });
  });
});
