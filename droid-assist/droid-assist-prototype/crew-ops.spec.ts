import { describe, expect, it, vi } from 'vitest';
import {
  backtrackSteps,
  detectTestRequest,
  groundSuggestion,
  runCrewTest,
  safetyVote,
  testReport,
  type PassResult,
} from './crew-ops.js';
import { buildCrew, type CrewAgent } from './crew.js';
import { REVERSE_ACTOR } from './reverse.js';
import type { ActionRecord, WorkflowStep } from './types.js';
import type { Knowledge } from './cross-reference.js';

const rec = (over: Partial<ActionRecord> = {}): ActionRecord => ({
  id: 'a1', time: 0, action: 'move', x: 200, y: 200, source: 'Replay', via: 'bridge', ok: true, message: 'Dispatched', srcW: 1000, srcH: 500, ...over,
});

const step = (over: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id: 's1', name: 'Step', action: 'click', x: 0.5, y: 0.5, status: 'pending', ...over,
});

const pass = (ok: boolean, detail = ''): PassResult => ({ ok, detail });

describe('detectTestRequest', () => {
  it('detects an obstacles request', () => {
    expect(detectTestRequest('monitor-1', 'there are too many obstacles')).toMatchObject({ from: 'monitor-1', reason: 'obstacles' });
  });

  it('detects an off-path request', () => {
    expect(detectTestRequest('pathChecker-1', 'we are off path')).toMatchObject({ reason: 'off-path' });
  });

  it('detects a plain requested test', () => {
    expect(detectTestRequest('ai', 'please run a test')).toMatchObject({ reason: 'requested' });
  });

  it('returns null when the text asks for nothing', () => {
    expect(detectTestRequest('ai', 'hello')).toBeNull();
  });
});

describe('runCrewTest', () => {
  it('runs the main-screen pass only after the background pass succeeds', async () => {
    const main = vi.fn(async () => pass(true, 'live ok'));
    const result = await runCrewTest(async () => pass(true, 'bg ok'), main);
    expect(main).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ passed: true, main: { ok: true, detail: 'live ok' } });
  });

  it('skips the main-screen pass when the background pass fails', async () => {
    const main = vi.fn(async () => pass(true));
    const result = await runCrewTest(async () => pass(false, 'bg failed'), main);
    expect(main).not.toHaveBeenCalled();
    expect(result).toEqual({ background: { ok: false, detail: 'bg failed' }, main: null, passed: false });
  });

  it('is not passed when the main-screen pass fails', async () => {
    const result = await runCrewTest(async () => pass(true), async () => pass(false, 'live failed'));
    expect(result.passed).toBe(false);
  });

  it('testReport mentions that the main-screen test was skipped when main is null', () => {
    const req = { from: 'monitor-1', reason: 'obstacles' as const, text: 'too many obstacles' };
    const r = { background: pass(false, 'bg failed'), main: null, passed: false };
    expect(testReport(req, r)).toContain('main-screen test skipped');
  });
});

describe('safetyVote', () => {
  const noHistory: ActionRecord[] = [];

  it('vetoes a ctrl+z key step', () => {
    const decision = safetyVote(step({ action: 'key', text: 'ctrl+z' }), noHistory, []);
    expect(decision.ok).toBe(false);
    expect(decision.votes.find((v) => v.check === 'undo-combo')?.ok).toBe(false);
  });

  it('vetoes a ctrl+y key step', () => {
    const decision = safetyVote(step({ action: 'key', text: 'ctrl+y' }), noHistory, []);
    expect(decision.votes.find((v) => v.check === 'undo-combo')?.ok).toBe(false);
  });

  it('vetoes a step equal to the reversal step of the newest history record', () => {
    const history = [rec({ action: 'move', x: 200, y: 200, prevX: 500, prevY: 250 })];
    const repeat = step({ action: 'move', x: 0.5, y: 0.5 });
    const decision = safetyVote(repeat, history, []);
    expect(decision.ok).toBe(false);
    expect(decision.votes.find((v) => v.check === 'reversal-repeat')?.ok).toBe(false);
  });

  it('vetoes an off-screen coordinate', () => {
    const decision = safetyVote(step({ x: 1.5 }), noHistory, []);
    expect(decision.ok).toBe(false);
    expect(decision.votes.find((v) => v.check === 'in-bounds')?.ok).toBe(false);
  });

  it('passes a normal click', () => {
    const decision = safetyVote(step({ action: 'click', x: 0.4, y: 0.6 }), noHistory, []);
    expect(decision.ok).toBe(true);
    expect(decision.votes.every((v) => v.ok)).toBe(true);
  });

  it('assigns votes round-robin to the given voter ids', () => {
    const voters: CrewAgent[] = buildCrew(5).filter((a) => a.role === 'sentinel' || a.role === 'pathChecker');
    const decision = safetyVote(step({ action: 'click', x: 0.4, y: 0.6 }), noHistory, voters);
    decision.votes.forEach((v, i) => expect(v.agentId).toBe(voters[i % voters.length].id));
  });
});

describe('backtrackSteps', () => {
  const good = (id: string, over: Partial<ActionRecord> = {}) => rec({ id, action: 'click', x: 300, y: 300, prevX: 100, prevY: 150, ...over });

  it('produces one move step per real action, newest first, to the previous position', () => {
    const history = [good('a'), good('b')];
    const steps = backtrackSteps(history, 2);
    expect(steps).toHaveLength(2);
    expect(steps.every((s) => s.action === 'move')).toBe(true);
    expect(steps[0]).toMatchObject({ x: 100 / 1000, y: 150 / 500 });
    expect(steps[1]).toMatchObject({ x: 100 / 1000, y: 150 / 500 });
  });

  it('falls back to x/y when prevX/prevY are missing', () => {
    const history = [good('a', { prevX: undefined, prevY: undefined })];
    const steps = backtrackSteps(history, 1);
    expect(steps[0]).toMatchObject({ x: 300 / 1000, y: 300 / 500 });
  });

  it('skips records from source Reverse, failed records, and records with no srcW', () => {
    const history = [
      good('reverse', { source: REVERSE_ACTOR }),
      good('failed', { ok: false }),
      good('nosize', { srcW: undefined }),
      good('kept'),
    ];
    const steps = backtrackSteps(history, 10);
    expect(steps).toHaveLength(1);
    expect(steps[0].id).toContain('kept');
  });

  it('limits the result to n steps', () => {
    const history = [good('a'), good('b'), good('c')];
    expect(backtrackSteps(history, 2)).toHaveLength(2);
  });
});

describe('groundSuggestion', () => {
  const emptyKnowledge: Knowledge = { map: [], familiar: [], habits: [], patterns: [], context: '' };

  it('is not grounded with no history and says so', () => {
    const result = groundSuggestion('Play button', { x: 0.5, y: 0.5 }, emptyKnowledge);
    expect(result.grounded).toBe(false);
    expect(result.text).toContain('no history');
  });

  it('is grounded when a familiar element of the same name sits at the same point', () => {
    const knowledge: Knowledge = { ...emptyKnowledge, familiar: [{ id: 'f1', name: 'Play button', x: 0.5, y: 0.5, lastSeen: 0 }] };
    const result = groundSuggestion('Play button', { x: 0.5, y: 0.5 }, knowledge);
    expect(result.grounded).toBe(true);
  });
});
