import { describe, expect, it } from 'vitest';
import type { WorkflowStep } from './types.js';
import { checkoffSummary, checkoffText, completeText, incompleteText, workflowComplete } from './workflow-progress.js';

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

describe('workflow completion and incomplete reports', () => {
  it('is complete only when every step of a non-empty workflow is checked off', () => {
    expect(workflowComplete(checkoffSummary([]))).toBe(false);
    expect(workflowComplete(checkoffSummary([step('a', { verifiedAt: 1 }), step('b')]))).toBe(false);
    const all = checkoffSummary([step('a', { verifiedAt: 1 }), step('b', { verifiedAt: 2 }), step('c', { verifiedAt: 3 })]);
    expect(workflowComplete(all)).toBe(true);
    expect(completeText(all)).toBe('Workflow complete — all 3/3 steps checked off');
  });

  it('names the failed step, its reason and how far the workflow got', () => {
    const steps = [step('a', { verifiedAt: 1 }), step('b', { status: 'failed' }), step('c')];
    expect(incompleteText(steps, 1, 'target not found')).toBe('Workflow incomplete — step 2/3 "Step b" failed: target not found; 1/3 checked off (33%)');
  });
});
