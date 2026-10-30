import { describe, expect, it, vi } from 'vitest';
import type { GoalCheck } from './assist-ai.js';
import {
  CROSS_REFERENCE_LINES,
  continueJoint,
  crossReference,
  isStale,
  verifyJoint,
  type AppSnapshot,
  type ContinuationDeps,
  type JointAction,
  type JointFollowUpDeps,
  type JointTurn,
} from './joint-followup.js';
import { createProject } from './project.js';

const action = (overrides: Partial<JointAction> = {}): JointAction => ({
  id: 'a1',
  app: 'droid-new',
  label: 'Save the file',
  phase: 'current',
  expect: 'file is saved',
  ...overrides,
});

const snapshot = (overrides: Partial<AppSnapshot> = {}): AppSnapshot => ({
  app: 'droid-new',
  time: 1000,
  screenshot: null,
  log: [],
  notes: [],
  ...overrides,
});

describe('verifyJoint', () => {
  const endedAt = 1000;

  it('verifies only the current actions against fresh snapshots', async () => {
    const actions = [
      action({ id: 'past', app: 'droid-new', phase: 'past' }),
      action({ id: 'cur-new', app: 'droid-new', phase: 'current' }),
      action({ id: 'cur-main', app: 'droid-main', phase: 'current' }),
      action({ id: 'planned', app: 'droid-main', phase: 'planned' }),
    ];
    const deps: JointFollowUpDeps = {
      snapshot: vi.fn(async (app) => snapshot({ app, time: endedAt })),
      verify: vi.fn(async () => ({ ok: true, reason: 'matches' })),
      retry: vi.fn(async () => {}),
      now: () => endedAt,
    };
    const report = await verifyJoint(actions, endedAt, deps);
    expect(report.done).toBe(true);
    expect(report.items.map((i) => i.id).sort()).toEqual(['cur-main', 'cur-new']);
  });

  it('a stale droid-main snapshot fails its action without calling verify', async () => {
    const actions = [action({ id: 'cur-main', app: 'droid-main', phase: 'current' })];
    const verify = vi.fn(async () => ({ ok: true, reason: 'matches' }));
    const deps: JointFollowUpDeps = {
      snapshot: vi.fn(async (app) => snapshot({ app, time: app === 'droid-main' ? endedAt - 500 : endedAt })),
      verify,
      retry: vi.fn(async () => {}),
      now: () => endedAt,
    };
    const report = await verifyJoint(actions, endedAt, deps, 1);
    const item = report.items.find((i) => i.id === 'cur-main')!;
    expect(item.state).toBe('unresolved');
    expect(item.reason).toContain('stale');
    expect(verify).not.toHaveBeenCalled();
  });

  it('retries a failed action once, with the pass number and the prior reason, then passes', async () => {
    const actions = [action({ id: 'cur', app: 'droid-new', phase: 'current' })];
    let verifyCalls = 0;
    const verify = vi.fn(async () => {
      verifyCalls += 1;
      return verifyCalls === 1 ? { ok: false, reason: 'not yet visible' } : { ok: true, reason: 'now visible' };
    });
    const retry = vi.fn(async () => {});
    const deps: JointFollowUpDeps = {
      snapshot: vi.fn(async (app, since) => snapshot({ app, time: since })),
      verify,
      retry,
      now: () => endedAt + 50,
    };
    const report = await verifyJoint(actions, endedAt, deps);
    expect(report.done).toBe(true);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith(actions[0], 2, 'not yet visible');
  });

  it('gives verify a context built from both apps\' logs and the past/planned actions', async () => {
    const actions = [
      action({ id: 'past', app: 'droid-new', phase: 'past', label: 'Opened menu' }),
      action({ id: 'cur', app: 'droid-new', phase: 'current' }),
      action({ id: 'planned', app: 'droid-main', phase: 'planned', label: 'Close dialog' }),
    ];
    const verify = vi.fn<JointFollowUpDeps['verify']>(async () => ({ ok: true, reason: 'ok' }));
    const deps: JointFollowUpDeps = {
      snapshot: vi.fn(async (app) => snapshot({ app, time: endedAt, log: [`${app} did something`] })),
      verify,
      retry: vi.fn(async () => {}),
      now: () => endedAt,
    };
    await verifyJoint(actions, endedAt, deps);
    const context = verify.mock.calls[0][2];
    expect(context.some((l) => l.includes('[droid-new log]'))).toBe(true);
    expect(context.some((l) => l.includes('[droid-main log]'))).toBe(true);
    expect(context.some((l) => l.includes('Opened menu'))).toBe(true);
    expect(context.some((l) => l.includes('Close dialog'))).toBe(true);
  });

  it('requests the droid-main snapshot since endedAt on pass 1', async () => {
    const actions = [action({ id: 'cur', app: 'droid-main', phase: 'current' })];
    const snapshotFn = vi.fn(async (app: 'droid-new' | 'droid-main') => snapshot({ app, time: endedAt }));
    const deps: JointFollowUpDeps = { snapshot: snapshotFn, verify: vi.fn(async () => ({ ok: true, reason: 'ok' })), retry: vi.fn(async () => {}), now: () => endedAt };
    await verifyJoint(actions, endedAt, deps);
    expect(snapshotFn).toHaveBeenCalledWith('droid-main', endedAt);
  });
});

describe('crossReference', () => {
  it('lists actions, then each app\'s screen/log/note lines capped at CROSS_REFERENCE_LINES', () => {
    const actions = [action({ phase: 'current', app: 'droid-new', label: 'Save', expect: 'saved' })];
    const logLines = Array.from({ length: CROSS_REFERENCE_LINES + 3 }, (_, i) => `log ${i}`);
    const noteLines = Array.from({ length: CROSS_REFERENCE_LINES + 3 }, (_, i) => `note ${i}`);
    const snaps = [snapshot({ app: 'droid-new', log: logLines, notes: noteLines })];
    const lines = crossReference(actions, snaps);
    expect(lines[0]).toBe('[current · droid-new] Save — expect: saved');
    expect(lines.filter((l) => l.startsWith('[droid-new log]'))).toHaveLength(CROSS_REFERENCE_LINES);
    expect(lines.filter((l) => l.startsWith('[droid-new note]'))).toHaveLength(CROSS_REFERENCE_LINES);
  });
});

describe('isStale', () => {
  it('is stale when the snapshot predates `since`', () => {
    expect(isStale(snapshot({ time: 100 }), 200)).toBe(true);
  });

  it('is not stale when the snapshot is at or after `since`', () => {
    expect(isStale(snapshot({ time: 200 }), 200)).toBe(false);
  });
});

const goalCheck = (overrides: Partial<GoalCheck> = {}): GoalCheck => ({ complete: true, progress: true, reason: 'looks done', thinking: null, ...overrides });
const jointTurn = (): JointTurn => ({ actions: [], endedAt: 1000 });

describe('continueJoint', () => {
  it('completes after one turn when follow-up is done and the goal check is complete with nothing pending', async () => {
    const deps: ContinuationDeps = {
      halt: () => null,
      turn: vi.fn(async () => jointTurn()),
      followUp: vi.fn(async () => ({ passes: 1, items: [], done: true })),
      check: vi.fn(async () => goalCheck()),
      pending: () => 0,
    };
    const result = await continueJoint(createProject('Joint op', 'Do the thing'), deps);
    expect(result.completion.done).toBe(true);
    expect(result.turns).toBe(1);
  });

  it('loops once more after an incomplete check, injecting the reason into the next turn', async () => {
    let call = 0;
    const check = vi.fn(async () => {
      call += 1;
      return call === 1 ? goalCheck({ complete: false, reason: 'still mid-flight' }) : goalCheck({ complete: true, reason: 'done now' });
    });
    const turn = vi.fn<ContinuationDeps['turn']>(async () => jointTurn());
    const deps: ContinuationDeps = { halt: () => null, turn, followUp: vi.fn(async () => ({ passes: 1, items: [], done: true })), check, pending: () => 0 };
    const result = await continueJoint(createProject('Joint op', 'Do the thing'), deps);
    expect(result.turns).toBe(2);
    expect(result.completion.done).toBe(true);
    const secondCallInjected = turn.mock.calls[1][1];
    expect(secondCallInjected.some((t) => t.includes('still mid-flight'))).toBe(true);
  });

  it('does not finish a turn when follow-up is unresolved even if the goal check is complete', async () => {
    const deps: ContinuationDeps = {
      halt: () => null,
      turn: vi.fn(async () => jointTurn()),
      followUp: vi.fn(async () => ({ passes: 1, items: [], done: false })),
      check: vi.fn(async () => goalCheck()),
      pending: () => 0,
      maxTurns: 1,
    };
    const result = await continueJoint(createProject('Joint op', 'Do the thing'), deps);
    expect(result.completion.done).toBe(false);
    expect(result.turns).toBe(1);
  });

  it('does not finish while commands are still waiting for approval', async () => {
    const deps: ContinuationDeps = {
      halt: () => null,
      turn: vi.fn(async () => jointTurn()),
      followUp: vi.fn(async () => ({ passes: 1, items: [], done: true })),
      check: vi.fn(async () => goalCheck()),
      pending: () => 1,
      maxTurns: 1,
    };
    const result = await continueJoint(createProject('Joint op', 'Do the thing'), deps);
    expect(result.completion.done).toBe(false);
    expect(result.project.injections[0]?.text).toContain('approval');
  });

  it('stops immediately with the guardrail reason when halt fires', async () => {
    const turn = vi.fn(async () => jointTurn());
    const deps: ContinuationDeps = { halt: () => 'guardrail triggered', turn, followUp: vi.fn(async () => ({ passes: 0, items: [], done: true })), check: vi.fn(async () => goalCheck()), pending: () => 0 };
    const result = await continueJoint(createProject('Joint op', 'Do the thing'), deps);
    expect(result.completion).toEqual({ done: false, reason: 'guardrail triggered' });
    expect(result.turns).toBe(0);
    expect(turn).not.toHaveBeenCalled();
  });

  it('gives up at the turn cap, reporting it not done', async () => {
    const deps: ContinuationDeps = {
      halt: () => null,
      turn: vi.fn(async () => jointTurn()),
      followUp: vi.fn(async () => ({ passes: 1, items: [], done: true })),
      check: vi.fn(async () => goalCheck({ complete: false, reason: 'never ready' })),
      pending: () => 0,
      maxTurns: 2,
    };
    const result = await continueJoint(createProject('Joint op', 'Do the thing'), deps);
    expect(result.completion.done).toBe(false);
    expect(result.turns).toBe(2);
  });
});
