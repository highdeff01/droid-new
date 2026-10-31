import { describe, expect, it } from 'vitest';
import type { AppDecision } from './app-selection.js';
import { JOINT_OP, RECALL_LIMIT, appTally, jointDraft, recallLines, recallSimilar, type JointOutcome } from './joint-memory.js';
import type { OperationRecord } from './operation-db.js';
import { buildOperation } from './operation-log.js';

const decision = (overrides: Partial<AppDecision> = {}): AppDecision => ({ operation: 'Save file', calculate: 'droid-new', perform: 'droid-main', mode: 'split', reason: 'droid-new arbitrates: cheapest', ...overrides });

const outcome = (overrides: Partial<JointOutcome> = {}): JointOutcome => ({ operation: 'Save file', app: 'droid-main', role: 'perform', ok: true, output: 'saved', ...overrides });

const record = (overrides: Partial<OperationRecord> = {}): OperationRecord =>
  buildOperation({ project: 'P', agent: 'joint', section: 'joint' }, { category: 'track', op: JOINT_OP, element: 'Save file', input: 'in', output: 'out', ok: true, ...overrides }, overrides.time ?? Date.now());

describe('jointDraft', () => {
  it('attributes the draft to the outcome app with the operation as element and the role/mode in the input', () => {
    const draft = jointDraft(outcome(), decision());
    expect(draft.app).toBe('droid-main');
    expect(draft.op).toBe(JOINT_OP);
    expect(draft.element).toBe('Save file');
    expect(draft.ok).toBe(true);
    expect(draft.output).toBe('saved');
    expect(draft.input).toContain('perform');
    expect(draft.input).toContain('split');
  });
});

describe('appTally', () => {
  it('counts attributed records of a similar operation per app, ok and failed separately', () => {
    const records: OperationRecord[] = [
      record({ app: 'droid-main', ok: true, time: 1 }),
      record({ app: 'droid-main', ok: false, time: 2 }),
      record({ app: 'droid-new', ok: true, time: 3 }),
    ];
    const tally = appTally(records, 'Save file');
    expect(tally['droid-main']).toEqual({ ok: 1, failed: 1 });
    expect(tally['droid-new']).toEqual({ ok: 1, failed: 0 });
  });

  it('ignores unattributed records and records of dissimilar operations', () => {
    const records: OperationRecord[] = [
      { ...record({ ok: true, time: 1 }), app: undefined },
      record({ app: 'droid-main', ok: true, time: 2, element: 'Completely unrelated thing' }),
    ];
    const tally = appTally(records, 'Save file');
    expect(tally['droid-main']).toEqual({ ok: 0, failed: 0 });
    expect(tally['droid-new']).toEqual({ ok: 0, failed: 0 });
  });
});

describe('recallSimilar', () => {
  it('returns only attributed, similar records, newest first', () => {
    const records: OperationRecord[] = [
      record({ app: 'droid-main', time: 1 }),
      { ...record({ time: 2 }), app: undefined },
      record({ app: 'droid-new', time: 3, element: 'unrelated other task' }),
      record({ app: 'droid-new', time: 4 }),
    ];
    const result = recallSimilar(records, 'Save file');
    expect(result.map((r) => r.time)).toEqual([4, 1]);
  });
});

describe('recallLines', () => {
  it('formats worked/failed lines per app, capped at RECALL_LIMIT', () => {
    const records: OperationRecord[] = Array.from({ length: RECALL_LIMIT + 3 }, (_, i) =>
      record({ app: i % 2 === 0 ? 'droid-main' : 'droid-new', ok: i % 2 === 0, time: i, output: `out-${i}` }));
    const lines = recallLines(records, 'Save file');
    expect(lines).toHaveLength(RECALL_LIMIT);
    expect(lines[0]).toMatch(/^\[droid-(main|new) (worked|failed)\]/);
  });
});
