import { describe, expect, it, vi } from 'vitest';
import type { AskFn } from './ai.js';
import type { Frame, WorkflowStep } from './types.js';
import { askWorkaround, localWorkaround, type KnownPoint } from './workarounds.js';

const step = (id: string, overrides: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id,
  name: `Step ${id}`,
  action: 'click',
  x: 0.2,
  y: 0.3,
  status: 'pending',
  ...overrides,
});

const frame = { id: 1, url: 'data:image/jpeg;base64,QUJD' } as Frame;
const ask = (reply: Record<string, unknown>, thinking: string | null = null): AskFn =>
  vi.fn(async () => ({ content: JSON.stringify(reply), thinking }));

describe('localWorkaround', () => {
  it('retargets to a known element of the same name at another position', () => {
    const steps = [step('a', { target: 'Save button', x: 0.2, y: 0.3 })];
    const known: KnownPoint[] = [{ name: 'Save button', x: 0.8, y: 0.9 }];
    const w = localWorkaround(steps, 1, known);
    expect(w?.edits).toEqual([{ kind: 'retarget', at: 1, x: 0.8, y: 0.9, target: 'Save button' }]);
  });

  it('adds a wait step before the failed step when no known element matches', () => {
    const steps = [step('a', { target: 'Save button' })];
    const w = localWorkaround(steps, 1, []);
    expect(w?.edits).toHaveLength(1);
    const edit = w?.edits[0];
    expect(edit?.kind).toBe('add');
    if (edit?.kind === 'add') {
      expect(edit.at).toBe(1);
      expect(edit.step.action).toBe('wait');
    }
  });

  it('returns null when the failed step is already preceded by a wait', () => {
    const steps = [step('w', { action: 'wait' }), step('a', { target: 'Save button' })];
    const w = localWorkaround(steps, 2, []);
    expect(w).toBeNull();
  });

  it('returns null for an out-of-range index', () => {
    const steps = [step('a')];
    expect(localWorkaround(steps, 5, [])).toBeNull();
  });
});

describe('askWorkaround', () => {
  it('parses add/remove/reorder/retarget edits from the reply', async () => {
    const steps = [step('a'), step('b'), step('c')];
    const fn = ask({
      edits: [
        { kind: 'add', at: 1, action: 'click', name: 'New step', cell: 'A1', cx: 0.5, cy: 0.5 },
      ],
      reason: 'the button moved',
    });
    const { workaround } = await askWorkaround(fn, frame, steps, 1, 'click failed', 'goal');
    expect(workaround?.edits).toEqual([
      expect.objectContaining({ kind: 'add', at: 1, step: expect.objectContaining({ name: 'New step', action: 'click' }) }),
    ]);
    expect(workaround?.reason).toBe('the button moved');
  });

  it('keeps at most 2 edits', async () => {
    const steps = [step('a'), step('b'), step('c'), step('d')];
    const fn = ask({
      edits: [
        { kind: 'remove', at: 1 },
        { kind: 'remove', at: 2 },
        { kind: 'remove', at: 3 },
      ],
    });
    const { workaround } = await askWorkaround(fn, frame, steps, 1, 'failed', 'goal');
    expect(workaround?.edits).toHaveLength(2);
  });

  it('returns workaround null when the parsed edits do not fit the steps', async () => {
    const steps = [step('a'), step('b')];
    const fn = ask({ edits: [{ kind: 'remove', at: 9 }] });
    const { workaround } = await askWorkaround(fn, frame, steps, 1, 'failed', 'goal');
    expect(workaround).toBeNull();
  });

  it('returns workaround null when an add edit has an invalid step action', async () => {
    const steps = [step('a'), step('b')];
    const fn = ask({ edits: [{ kind: 'add', at: 1, action: 'bogus', name: 'X', cell: 'A1', cx: 0.5, cy: 0.5 }] });
    const { workaround } = await askWorkaround(fn, frame, steps, 1, 'failed', 'goal');
    expect(workaround).toBeNull();
  });

  it('defaults the reason when the reply omits it', async () => {
    const steps = [step('a'), step('b')];
    const fn = ask({ edits: [{ kind: 'remove', at: 1 }] });
    const { workaround } = await askWorkaround(fn, frame, steps, 1, 'failed', 'goal');
    expect(workaround?.reason).toBe('AI workaround');
  });
});
