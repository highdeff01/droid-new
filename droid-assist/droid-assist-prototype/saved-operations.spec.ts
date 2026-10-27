import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Frame, WorkflowStep } from './types.js';
import { OPERATION_SHOT_LIMIT, countRun, createOperation, notifySuggestion, referenceShots, suggestOperations, upsertOperation } from './saved-operations.js';
import type { SavedOperation } from './saved-operations.js';

const frame = (id: number, v: number): Frame => ({
  id,
  time: 0,
  url: 'data:image/jpeg;base64,x',
  data: { width: 320, height: 180, data: new Uint8ClampedArray(320 * 180 * 4).fill(v), colorSpace: 'srgb' } as unknown as ImageData,
  srcW: 1920,
  srcH: 1080,
  source: 'demo',
});

const op = (overrides: Partial<SavedOperation> = {}): SavedOperation => ({
  id: 'op1',
  name: 'Op',
  goal: 'open youtube in chrome',
  steps: [],
  screenshots: [],
  source: 'recorded',
  savedAt: 0,
  runs: 0,
  successes: 0,
  ...overrides,
});

afterEach(() => vi.unstubAllGlobals());

describe('createOperation', () => {
  it('trims the name, defaults the goal to the name when blank, resets steps to pending stripped of run evidence, zeroes counters', () => {
    const step: WorkflowStep = { id: 's1', name: 'Click', action: 'click', x: 0.5, y: 0.5, status: 'done', beforeFrame: frame(1, 10), afterFrame: frame(2, 20), shot: frame(3, 30) };
    const created = createOperation({ name: '  My Op  ', goal: '   ', steps: [step], screenshots: [], source: 'recorded' }, 1000);
    expect(created.name).toBe('My Op');
    expect(created.goal).toBe('My Op');
    expect(created.steps).toEqual([{ id: 's1', name: 'Click', action: 'click', x: 0.5, y: 0.5, status: 'pending' }]);
    expect(created.runs).toBe(0);
    expect(created.successes).toBe(0);
  });
});

describe('upsertOperation', () => {
  const existing = op({ id: '1', name: 'Open Chrome', runs: 5, successes: 3 });
  const other = op({ id: '2', name: 'Other' });

  it('replaces a same-name (case-insensitive) op, keeping its old id/runs/successes, puts it first, keeps every other one', () => {
    const incoming = op({ id: 'new', name: 'open chrome', runs: 0, successes: 0 });
    const { ops, replaced } = upsertOperation([existing, other], incoming);
    expect(replaced).toEqual(existing);
    expect(ops).toEqual([{ ...incoming, id: '1', runs: 5, successes: 3 }, other]);
  });

  it('prepends a different-name op, dropping nothing', () => {
    const incoming = op({ id: 'new', name: 'Brand New' });
    const { ops, replaced } = upsertOperation([existing, other], incoming);
    expect(replaced).toBeNull();
    expect(ops).toEqual([incoming, existing, other]);
  });
});

describe('countRun', () => {
  const ops = [op({ id: '1', runs: 5, successes: 3 }), op({ id: '2', runs: 0, successes: 0 })];

  it('increments runs, adds a success only on success, sets lastRun', () => {
    expect(countRun(ops, '1', true, 500)[0]).toMatchObject({ runs: 6, successes: 4, lastRun: 500 });
  });

  it('increments runs without a success on failure', () => {
    expect(countRun(ops, '1', false, 500)[0]).toMatchObject({ runs: 6, successes: 3, lastRun: 500 });
  });

  it('leaves other operations untouched', () => {
    expect(countRun(ops, '1', true, 500)[1]).toEqual(ops[1]);
  });
});

describe('suggestOperations', () => {
  const chromeOp = op({ id: 'c', name: 'YouTube on Chrome', goal: 'open youtube in chrome' });
  const unrelatedOp = op({ id: 'u', name: 'Close Notepad', goal: 'close notepad window' });

  it('returns the matching op first and excludes ops sharing no word', () => {
    const result = suggestOperations('open youtube in chrome', [unrelatedOp, chromeOp]);
    expect(result[0]).toBe(chromeOp);
    expect(result).not.toContain(unrelatedOp);
  });
});

describe('referenceShots', () => {
  it('dedupes by frame id and caps at OPERATION_SHOT_LIMIT', () => {
    const steps: WorkflowStep[] = [
      { id: 's0', name: 's', action: 'click', x: 0.5, y: 0.5, status: 'pending', refFrame: frame(0, 0), afterFrame: frame(0, 0) },
      ...Array.from({ length: 7 }, (_, i) => ({ id: `s${i + 1}`, name: 's', action: 'click' as const, x: 0.5, y: 0.5, status: 'pending' as const, afterFrame: frame(i + 1, i + 1) })),
    ];
    const result = referenceShots(steps, null);
    expect(result).toHaveLength(OPERATION_SHOT_LIMIT);
    expect(result.map((f) => f.id)).toEqual([2, 3, 4, 5, 6, 7]);
  });
});

describe('notifySuggestion', () => {
  it('is false when Notification is undefined', () => {
    vi.stubGlobal('Notification', undefined);
    expect(notifySuggestion('go to chrome')).toBe(false);
  });

  it('is false when permission is "default"', () => {
    vi.stubGlobal('Notification', { permission: 'default' });
    expect(notifySuggestion('go to chrome')).toBe(false);
  });

  it('is true and constructs one when a stubbed Notification has permission "granted"', () => {
    class StubNotification {
      static permission = 'granted';
      constructor(public title: string, public opts: { body: string }) {}
    }
    const ctor = vi.fn((title: string, opts: { body: string }) => new StubNotification(title, opts));
    (ctor as unknown as { permission: string }).permission = 'granted';
    vi.stubGlobal('Notification', ctor);
    expect(notifySuggestion('go to chrome')).toBe(true);
    expect(ctor).toHaveBeenCalledWith('Droid Assist suggests', { body: 'go to chrome' });
  });
});
