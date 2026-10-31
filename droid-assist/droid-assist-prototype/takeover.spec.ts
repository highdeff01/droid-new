import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIRST_STEP_MS, VOTE_WAIT_MS, createTakeover, detectStalledStep, handoffPayload, stepCompletion, type TakeoverDeps } from './takeover.js';
import { validateInbound, type InboundMessage, type OutboundPayloads, type OutboundType } from './main-bridge-protocol.js';
import type { WorkflowStep } from './types.js';

const steps: WorkflowStep[] = [
  { id: 's1', name: 'Click Files', action: 'click', x: 0.05, y: 0.1, target: 'Files icon', status: 'pending', correctedX: 0.06, correctedY: 0.11 },
  { id: 's2', name: 'Drag Report', action: 'drag', x: 0.9, y: 0.2, endX: 0.9, endY: 0.7, status: 'pending' },
  { id: 's3', name: 'Type hi', action: 'type', x: 0.5, y: 0.5, text: 'hi', status: 'pending' },
];

function host(connected = true) {
  const sent: Array<{ type: OutboundType; payload: unknown }> = [];
  const logs: string[] = [];
  const ai: string[] = [];
  const settled: Array<[number, string]> = [];
  const deps: TakeoverDeps = {
    send: vi.fn(async <K extends OutboundType>(type: K, payload: OutboundPayloads[K]) => {
      sent.push({ type, payload });
      return { ok: true, message: 'taking over' };
    }),
    connected: () => connected,
    context: (i) => ({ screenshots: ['data:image/jpeg;base64,a', 'data:image/jpeg;base64,b'], tried: [`attempt 1 on step ${i + 1}: no visible change`] }),
    tellAi: (n) => ai.push(n),
    log: (m) => logs.push(m),
    onSettled: (i, c) => settled.push([i, c.state]),
  };
  return { deps, sent, logs, ai, settled, takeover: createTakeover(deps) };
}

const inbound = (type: string, payload: Record<string, unknown>) => {
  const parsed = validateInbound({ v: 1, id: 'm1', time: 1, type, payload });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.message as InboundMessage;
};

describe('first-step takeover', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('hands step 1 to droid-main with full context when it is not verified within 10 s', async () => {
    const h = host();
    const runId = h.takeover.startRun('open files', steps);
    await vi.advanceTimersByTimeAsync(FIRST_STEP_MS - 1);
    expect(h.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sent).toHaveLength(1);
    const { type, payload } = h.sent[0] as { type: string; payload: ReturnType<typeof handoffPayload> };
    expect(type).toBe('takeover_request');
    expect(payload).toMatchObject({ runId, goal: 'open files', stepIndex: 0, step: { name: 'Click Files', x: 0.06, y: 0.11, target: 'Files icon' } });
    expect(payload.remaining.map((s) => s.name)).toEqual(['Click Files', 'Drag Report', 'Type hi']);
    expect(payload.screenshots).toHaveLength(2);
    expect(payload.tried[0]).toMatch(/no visible change/);
    expect(payload.reason).toMatch(/10 s/);
    expect(h.ai.some((n) => /hands step 1\/3/.test(n) && /do not restart/.test(n))).toBe(true);
    expect(h.logs.some((l) => /accepted step 1/.test(l))).toBe(true);
    expect(h.takeover.handedOver(0)).toBe(true);
  });

  it('does not hand over a first step verified inside the 10 s', async () => {
    const h = host();
    h.takeover.startRun('open files', steps);
    await vi.advanceTimersByTimeAsync(4000);
    h.takeover.stepVerified(0, true, 'screen changed');
    await vi.advanceTimersByTimeAsync(FIRST_STEP_MS);
    expect(h.sent.map((s) => s.type)).toEqual(['step_report']);
  });

  it('arms the timer for step 1 only: later steps are never handed over by the timer', async () => {
    const h = host();
    h.takeover.startRun('open files', steps);
    h.takeover.stepVerified(0, true, 'ok');
    await vi.advanceTimersByTimeAsync(FIRST_STEP_MS * 5);
    expect(h.sent.some((s) => s.type === 'takeover_request')).toBe(false);
  });

  it('logs the undelivered handoff when droid-main is not connected', async () => {
    const h = host(false);
    h.takeover.startRun('open files', steps);
    await vi.advanceTimersByTimeAsync(FIRST_STEP_MS);
    expect(h.sent).toHaveLength(0);
    expect(h.logs.some((l) => /not delivered/.test(l))).toBe(true);
  });
});

describe('droid-main claims', () => {
  it('hands over the step droid-main detected incomplete, resuming at that step, once', async () => {
    const h = host();
    const runId = h.takeover.startRun('open files', steps);
    h.takeover.stepVerified(0, true, 'ok');
    expect(h.takeover.onInbound(inbound('takeover_claim', { runId, stepIndex: 1, reason: 'drag not finished' }))).toBe(true);
    h.takeover.onInbound(inbound('takeover_claim', { runId, stepIndex: 1, reason: 'again' }));
    await Promise.resolve();
    const requests = h.sent.filter((s) => s.type === 'takeover_request').map((s) => s.payload as ReturnType<typeof handoffPayload>);
    expect(requests).toHaveLength(1);
    expect(requests[0].stepIndex).toBe(1);
    expect(requests[0].remaining.map((s) => s.name)).toEqual(['Drag Report', 'Type hi']);
    expect(requests[0].reason).toMatch(/drag not finished/);
  });

  it('logs and tells the AI droid-main\'s takeover result, and ignores messages of another run', () => {
    const h = host();
    const runId = h.takeover.startRun('open files', steps);
    expect(h.takeover.onInbound(inbound('takeover_result', { runId: 'other', stepIndex: 0, ok: true, message: 'x' }))).toBe(false);
    h.takeover.onInbound(inbound('takeover_result', { runId, stepIndex: 0, ok: true, message: 'clicked Files' }));
    expect(h.logs.at(-1)).toMatch(/completed handed-over step 1: clicked Files/);
    expect(h.ai.at(-1)).toMatch(/clicked Files/);
  });
});

describe('step completion', () => {
  it('is complete only when droid-new verified AND both sides\' agents agree', () => {
    const h = host();
    const runId = h.takeover.startRun('open files', steps);
    expect(h.takeover.stepVerified(0, true, 'ok')?.state).toBe('pending');
    expect(h.takeover.newAgentsVote(0, true, ['Watcher'], 'looks right')?.state).toBe('pending');
    expect(h.settled).toEqual([]);
    h.takeover.onInbound(inbound('agent_vote', { runId, stepIndex: 0, side: 'droid-main', agree: true, agents: ['Regulator'], note: 'ok' }));
    expect(h.settled).toEqual([[0, 'complete']]);
    expect(h.sent.map((s) => s.type)).toEqual(['step_report', 'agent_vote']);
  });

  it('fails a step when any of the three disagrees, even with droid-new verified', () => {
    expect(stepCompletion({ verified: true, newAgents: true, mainAgents: false }, true)).toMatchObject({ state: 'failed', why: 'droid-main agents disagreed' });
    expect(stepCompletion({ verified: false, newAgents: true, mainAgents: true }, true).state).toBe('failed');
    expect(stepCompletion({ verified: true, newAgents: false, mainAgents: true }, true).state).toBe('failed');
    expect(stepCompletion({ verified: true, newAgents: true }, true).state).toBe('pending');
  });

  it('rests on droid-new\'s verification and agents when droid-main is unavailable, and says so', () => {
    expect(stepCompletion({ verified: true, newAgents: true }, false)).toMatchObject({ state: 'complete', why: expect.stringMatching(/droid-main unavailable/) });
  });
});

describe('detectStalledStep', () => {
  it('waits for droid-main\'s agents before a step completes; a late agree completes it, silence fails it', async () => {
    vi.useFakeTimers();
    const h = host();
    const runId = h.takeover.startRun('open files', steps);
    h.takeover.stepVerified(0, true, 'ok');
    h.takeover.newAgentsVote(0, true, ['Verifier'], 'ok');
    const first = h.takeover.awaitCompletion(0);
    await vi.advanceTimersByTimeAsync(1000);
    h.takeover.onInbound(inbound('agent_vote', { runId, stepIndex: 0, side: 'droid-main', agree: true, agents: ['Regulator'] }));
    expect(await first).toMatchObject({ state: 'complete' });
    h.takeover.stepVerified(1, true, 'ok');
    h.takeover.newAgentsVote(1, true, ['Verifier'], 'ok');
    const second = h.takeover.awaitCompletion(1);
    await vi.advanceTimersByTimeAsync(VOTE_WAIT_MS);
    vi.useRealTimers();
    expect(await second).toMatchObject({ state: 'failed', why: 'droid-main agents disagreed' });
  });

  it('logs and tells the AI droid-main\'s result after droid-new handed the run over', async () => {
    const h = host();
    const runId = h.takeover.startRun('open files', steps);
    expect(await h.takeover.handoff(0, 'stuck')).toBe(true);
    expect(h.takeover.onInbound(inbound('takeover_result', { runId, stepIndex: 0, ok: true, message: 'done by main' }))).toBe(true);
    expect(h.logs.some((l) => l.includes('done by main'))).toBe(true);
    expect(h.ai.some((l) => l.includes('done by main'))).toBe(true);
  });

  it('lets droid-main claim a step droid-new settled as failed, and the 10 s timer hand over a failed first step', async () => {
    vi.useFakeTimers();
    const h = host();
    const runId = h.takeover.startRun('open files', steps);
    h.takeover.stepVerified(0, false, 'no change');
    h.takeover.newAgentsVote(0, false, ['Verifier'], 'no change');
    h.takeover.stepVerified(2, false, 'no change');
    h.takeover.newAgentsVote(2, false, ['Verifier'], 'no change');
    h.takeover.onInbound(inbound('takeover_claim', { runId, stepIndex: 2, reason: 'stuck' }));
    await vi.advanceTimersByTimeAsync(FIRST_STEP_MS);
    vi.useRealTimers();
    expect(h.sent.filter((m) => m.type === 'takeover_request').map((m) => (m.payload as { stepIndex: number }).stepIndex).sort()).toEqual([0, 2]);
    expect(h.takeover.takenOver()).not.toBeNull();
  });

  it('flags an unverified step past the limit', () => {
    expect(detectStalledStep(0, FIRST_STEP_MS, false)).toBe(true);
    expect(detectStalledStep(0, FIRST_STEP_MS - 1, false)).toBe(false);
    expect(detectStalledStep(0, FIRST_STEP_MS * 2, true)).toBe(false);
  });
});

describe('takeover protocol messages', () => {
  it('validates droid-main\'s takeover messages and rejects malformed ones', () => {
    expect(validateInbound({ v: 1, id: 'a', type: 'takeover_claim', payload: { runId: 'r', stepIndex: 2, reason: 'stuck' } }).ok).toBe(true);
    expect(validateInbound({ v: 1, id: 'a', type: 'takeover_claim', payload: { runId: 'r', reason: 'stuck' } })).toEqual({ ok: false, error: 'takeover_claim needs runId and stepIndex' });
    expect(validateInbound({ v: 1, id: 'a', type: 'takeover_result', payload: { runId: 'r', stepIndex: 0 } })).toEqual({ ok: false, error: 'takeover_result needs ok and message' });
    expect(validateInbound({ v: 1, id: 'a', type: 'agent_vote', payload: { runId: 'r', stepIndex: 0, side: 'droid-new', agree: true } }).ok).toBe(false);
import { describe, expect, it, vi } from 'vitest';
import type { RegulatePayload } from './main-bridge-protocol.js';
import { agreementState, applyRegulate, arbitrate, shouldHandOff, stepComplete, syncAgreements, TAKEOVER_MS, withRemoteOpinion, type RegulateTarget, type StepAgreement } from './takeover.js';
import type { StepStatus, WorkflowStep } from './types.js';

describe('syncAgreements — a retried step', () => {
  const step = (status: StepStatus): WorkflowStep => ({ id: 's0', name: 'Open cart', action: 'click', x: 0.2, y: 0.4, status });
  it('re-gives droid-new\'s opinion when a failed step is re-run to done, so it can complete', () => {
    const statuses: StepStatus[] = ['running', 'failed', 'running', 'done'];
    const synced = statuses.reduce<StepAgreement[]>((prev, s) => syncAgreements(prev, [step(s)], 1000, () => false), []);
    const a = withRemoteOpinion(synced[0], { index: 0, step: 'Open cart', agree: true });
    expect(a).toMatchObject({ verified: true, local: true, remote: true });
    expect(agreementState(a)).toBe('complete');
    expect(shouldHandOff(a, 1000 + TAKEOVER_MS + 1)).toBe(false);
  });
});

const agreement = (over: Partial<StepAgreement> = {}): StepAgreement => ({
  index: 0,
  step: 'Click Save',
  owner: 'assist',
  verified: null,
  startedAt: 0,
  ...over,
});

describe('takeover', () => {
  describe('stepComplete', () => {
    it('is true only when verified, local and remote are all true', () => {
      expect(stepComplete(true, true, true)).toBe(true);
    });

    it('is false when the remote opinion is missing', () => {
      expect(stepComplete(true, true, undefined)).toBe(false);
    });

    it('is false when droid-new did not verify', () => {
      expect(stepComplete(false, true, true)).toBe(false);
    });

    it('is false when the local agents disagree', () => {
      expect(stepComplete(true, false, true)).toBe(false);
    });
  });

  describe('shouldHandOff', () => {
    it('does not hand off the first step before 10 s elapse', () => {
      const a = agreement({ index: 0, owner: 'assist', startedAt: 0 });
      expect(shouldHandOff(a, TAKEOVER_MS - 1)).toBe(false);
    });

    it('hands off the first step once 10 s elapse', () => {
      const a = agreement({ index: 0, owner: 'assist', startedAt: 0 });
      expect(shouldHandOff(a, TAKEOVER_MS)).toBe(true);
    });

    it('never hands off a step other than the first, even long after 10 s', () => {
      const a = agreement({ index: 1, owner: 'assist', startedAt: 0 });
      expect(shouldHandOff(a, 60_000)).toBe(false);
    });

    it('never hands off a step that is already complete', () => {
      const a = agreement({ index: 0, owner: 'assist', startedAt: 0, verified: true, local: true, remote: true });
      expect(shouldHandOff(a, 60_000)).toBe(false);
    });

    it('never hands off a step already owned by droid-main', () => {
      const a = agreement({ index: 0, owner: 'main', startedAt: 0 });
      expect(shouldHandOff(a, 60_000)).toBe(false);
    });
  });

  describe('arbitrate', () => {
    it('rules a verified step complete even when droid-main disagrees, citing the arbiter', () => {
      const a = agreement({ verified: true, local: true, remote: false });
      const ruling = arbitrate(a);
      expect(ruling.complete).toBe(true);
      expect(ruling.text).toContain('arbiter');
    });

    it('rules an unverified step not complete', () => {
      const a = agreement({ verified: false, local: true, remote: true });
      const ruling = arbitrate(a);
      expect(ruling.complete).toBe(false);
    });
  });

  describe('applyRegulate', () => {
    const target = (): RegulateTarget => ({
      pause: vi.fn(),
      stop: vi.fn(),
      resume: vi.fn(),
      setArmed: vi.fn(),
      setMode: vi.fn(),
    });

    it('calls pause for a pause command', () => {
      const t = target();
      applyRegulate({ command: 'pause' } as RegulatePayload, t, 'droid-main');
      expect(t.pause).toHaveBeenCalled();
    });

    it('calls stop for a stop command', () => {
      const t = target();
      applyRegulate({ command: 'stop' } as RegulatePayload, t, 'droid-main');
      expect(t.stop).toHaveBeenCalled();
    });

    it('calls resume for a resume command', () => {
      const t = target();
      applyRegulate({ command: 'resume' } as RegulatePayload, t, 'droid-main');
      expect(t.resume).toHaveBeenCalled();
    });

    it('calls setArmed(true) for an arm command', () => {
      const t = target();
      applyRegulate({ command: 'arm' } as RegulatePayload, t, 'droid-main');
      expect(t.setArmed).toHaveBeenCalledWith(true);
    });

    it('calls setArmed(false) for a disarm command', () => {
      const t = target();
      applyRegulate({ command: 'disarm' } as RegulatePayload, t, 'droid-main');
      expect(t.setArmed).toHaveBeenCalledWith(false);
    });

    it('calls setMode for a mode command', () => {
      const t = target();
      applyRegulate({ command: 'mode', mode: 'fast' } as RegulatePayload, t, 'droid-main');
      expect(t.setMode).toHaveBeenCalledWith('fast');
    });

    it('returns a log line naming the sender and the command', () => {
      const t = target();
      const line = applyRegulate({ command: 'pause' } as RegulatePayload, t, 'droid-main');
      expect(line).toContain('droid-main');
      expect(line).toContain('pause');
    });
  });
});
