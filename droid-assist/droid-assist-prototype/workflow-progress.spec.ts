import { describe, expect, it } from 'vitest';
import type { WorkflowStep } from './types.js';
import { checkoffSummary, checkoffText } from './workflow-progress.js';

const step = (id: string, patch: Partial<WorkflowStep> = {}): WorkflowStep => ({ id, name: `Step ${id}`, action: 'click', x: 0.1, y: 0.1, status: 'pending', ...patch });

describe('checkoffSummary', () => {
  it('counts only steps verified on the live frame, not merely executed ones', () => {
    const s = checkoffSummary([step('a', { status: 'done', verifiedAt: 5 }), step('b', { status: 'done' }), step('c')]);
    expect(s).toEqual({ checked: 1, total: 3, pct: 33 });
    expect(checkoffText(s)).toBe('1/3 checked off (33%)');
  });

  it('is 0% with no steps and 100% when every step is checked off', () => {
    expect(checkoffSummary([])).toEqual({ checked: 0, total: 0, pct: 0 });
    expect(checkoffSummary([step('a', { verifiedAt: 1 }), step('b', { verifiedAt: 2 })]).pct).toBe(100);
  });
});
