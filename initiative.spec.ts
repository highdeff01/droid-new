import { describe, expect, it } from 'vitest';
import type { Frame, WorkflowStep } from './types.js';
import {
  AI_SCAN_SEC_MIN,
  addProposal,
  applyEdits,
  disposition,
  editsText,
  nextScanDelay,
  setStatus,
  type Guard,
  type WorkflowEdit,
} from './initiative.js';

const step = (id: string, overrides: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id,
  name: `Step ${id}`,
  action: 'click',
  x: 0.2,
  y: 0.3,
  status: 'pending',
  ...overrides,
});

const guard = (overrides: Partial<Guard> = {}): Guard => ({
  aborted: false,
  stageOn: true,
  stageOffText: 'Screen scan is off',
  autoApply: false,
  armed: true,
  budgetLeft: 5,
  needsInput: false,
  ...overrides,
});

describe('disposition', () => {
  it('blocks when aborted, with a reason mentioning ABORTED', () => {
    const d = disposition('scan', guard({ aborted: true }));
    expect(d.kind).toBe('blocked');
    if (d.kind === 'blocked') expect(d.reason).toMatch(/ABORTED/);
  });

  it('blocks when the stage is off, with the guard\'s stageOffText as the reason', () => {
    const d = disposition('scan', guard({ stageOn: false, stageOffText: 'Screen scan is off' }));
    expect(d).toEqual({ kind: 'blocked', reason: 'Screen scan is off' });
  });

  it('proposes when auto-apply is off', () => {
    const d = disposition('scan', guard({ autoApply: false }));
    expect(d.kind).toBe('propose');
  });

  it('proposes when auto-apply is on but an input-sending initiative is disarmed', () => {
    const d = disposition('scan', guard({ autoApply: true, needsInput: true, armed: false, budgetLeft: 5 }));
    expect(d.kind).toBe('propose');
  });

  it('proposes when auto-apply is on but an input-sending initiative is out of budget', () => {
    const d = disposition('scan', guard({ autoApply: true, needsInput: true, armed: true, budgetLeft: 0 }));
    expect(d.kind).toBe('propose');
  });

  it('applies when auto-apply is on and the initiative needs no input, even disarmed and out of budget', () => {
    const d = disposition('scan', guard({ autoApply: true, needsInput: false, armed: false, budgetLeft: 0 }));
    expect(d).toEqual({ kind: 'apply' });
  });

  it('applies when auto-apply is on and an input-sending initiative is armed with budget left', () => {
    const d = disposition('scan', guard({ autoApply: true, needsInput: true, armed: true, budgetLeft: 1 }));
    expect(d).toEqual({ kind: 'apply' });
  });
});

describe('nextScanDelay', () => {
  it('uses the user interval in ms when the AI made no request', () => {
    expect(nextScanDelay(60)).toBe(60_000);
  });

  it('uses the AI request when it asks for sooner than the user interval', () => {
    expect(nextScanDelay(60, 20)).toBe(20_000);
  });

  it('caps an AI request later than the user interval at the user interval', () => {
    expect(nextScanDelay(60, 120)).toBe(60_000);
  });

  it('raises an AI request below AI_SCAN_SEC_MIN up to it', () => {
    expect(nextScanDelay(60, 2)).toBe(AI_SCAN_SEC_MIN * 1000);
  });

  it('ignores a NaN AI request', () => {
    expect(nextScanDelay(60, NaN)).toBe(60_000);
  });
});

describe('applyEdits', () => {
  it('add inserts a pending step at a 1-based position', () => {
    const out = applyEdits([step('a'), step('b')], [{ kind: 'add', at: 1, step: step('new', { status: 'done' }) }]);
    expect(out?.map((s) => s.id)).toEqual(['new', 'a', 'b']);
    expect(out?.[0].status).toBe('pending');
  });

  it('add at position length+1 appends the step', () => {
    const out = applyEdits([step('a'), step('b')], [{ kind: 'add', at: 3, step: step('new') }]);
    expect(out?.map((s) => s.id)).toEqual(['a', 'b', 'new']);
  });

  it('remove drops the step at the position', () => {
    const out = applyEdits([step('a'), step('b')], [{ kind: 'remove', at: 1 }]);
    expect(out?.map((s) => s.id)).toEqual(['b']);
  });

  it('remove refuses to empty a 1-step workflow', () => {
    expect(applyEdits([step('a')], [{ kind: 'remove', at: 1 }])).toBeNull();
  });

  it('reorder moves a step from one position to another', () => {
    const out = applyEdits([step('a'), step('b'), step('c')], [{ kind: 'reorder', from: 3, to: 1 }]);
    expect(out?.map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('retarget sets x/y/target and clears refFrame/correctedX', () => {
    const withRef = step('a', { refFrame: { id: 2, url: 'data:image/jpeg;base64,QUJD' } as Frame, correctedX: 0.1, correctedY: 0.2 });
    const out = applyEdits([withRef], [{ kind: 'retarget', at: 1, x: 0.7, y: 0.8, target: 'New target' }]);
    expect(out?.[0]).toMatchObject({ x: 0.7, y: 0.8, target: 'New target', refFrame: undefined, correctedX: undefined, correctedY: undefined });
  });

  it('returns null when any edit is out of range', () => {
    expect(applyEdits([step('a')], [{ kind: 'remove', at: 5 }])).toBeNull();
  });

  it('applies edits in order', () => {
    const out = applyEdits(
      [step('a'), step('b')],
      [
        { kind: 'add', at: 3, step: step('c') },
        { kind: 'remove', at: 1 },
      ],
    );
    expect(out?.map((s) => s.id)).toEqual(['b', 'c']);
  });
});

describe('addProposal', () => {
  const draft = (text: string, category: 'scan' | 'selfTest' | 'workaround' | 'workflow' = 'scan') => ({ category, text });

  it('adds a new proposal first', () => {
    const { proposals, added } = addProposal([], draft('Close the popup'));
    expect(proposals[0]).toBe(added);
    expect(proposals[0]).toMatchObject({ category: 'scan', text: 'Close the popup', status: 'pending' });
  });

  it('does not add a pending duplicate of the same category and normalised text', () => {
    const { proposals: first } = addProposal([], draft('Close the Popup!'));
    const { proposals: second, added } = addProposal(first, draft('close the popup'));
    expect(added).toBeNull();
    expect(second).toHaveLength(1);
  });

  it('adds again once the pending duplicate has been dismissed', () => {
    const { proposals: first } = addProposal([], draft('Close the popup'));
    const dismissed = setStatus(first, first[0].id, 'dismissed');
    const { proposals: second, added } = addProposal(dismissed, draft('Close the popup'));
    expect(added).not.toBeNull();
    expect(second).toHaveLength(2);
  });
});

describe('editsText', () => {
  it('describes each edit kind in one line, joined by "; "', () => {
    const edits: WorkflowEdit[] = [
      { kind: 'add', at: 2, step: step('n', { name: 'Click OK', action: 'click' }) },
      { kind: 'remove', at: 1 },
      { kind: 'reorder', from: 3, to: 1 },
      { kind: 'retarget', at: 1, x: 0.5, y: 0.5, target: 'OK button' },
    ];
    const lines = editsText(edits).split('; ');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('2');
    expect(lines[0]).toContain('Click OK');
    expect(lines[1]).toContain('1');
    expect(lines[2]).toContain('3');
    expect(lines[2]).toContain('1');
    expect(lines[3]).toContain('OK button');
  });
});
