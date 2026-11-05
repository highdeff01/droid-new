import { describe, expect, it } from 'vitest';
import type { WorkflowStep } from './types.js';
import { countAttempts, retryDue, retryText } from './auto-retry.js';

const step = (id: string, status: WorkflowStep['status']): WorkflowStep => ({ id, name: `Step ${id}`, action: 'click', x: 0.5, y: 0.5, status });

describe('automatic main retry selection', () => {
  const steps = [step('a', 'done'), step('b', 'failed'), step('c', 'pending'), step('d', 'drift'), step('e', 'running')];

  it('picks only failed and drifted steps', () => {
    expect(retryDue(steps, new Map(), 2)).toEqual([1, 3]);
  });

  it('stops picking a step once it has used its automatic attempts', () => {
    const once = countAttempts(new Map(), ['b', 'd']);
    expect(retryDue(steps, once, 2)).toEqual([1, 3]);
    const twice = countAttempts(once, ['b']);
    expect(retryDue(steps, twice, 2)).toEqual([3]);
    expect(retryDue(steps, twice, 0)).toEqual([]);
  });

  it('counts without mutating the previous counts', () => {
    const before = new Map([['b', 1]]);
    const after = countAttempts(before, ['b', 'x']);
    expect(before.get('b')).toBe(1);
    expect(after.get('b')).toBe(2);
    expect(after.get('x')).toBe(1);
  });

  it('names each step, its status and its attempt in the log line', () => {
    const counts = countAttempts(new Map(), ['b']);
    expect(retryText([steps[1]], counts, 3)).toBe('Re-running 1 failed/drifted step(s) automatically through the gated pipeline: "Step b" (failed, attempt 1/3)');
  });
});
