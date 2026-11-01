import { describe, expect, it, vi } from 'vitest';
import { createCooperativeControl, type AgentReview, type WorkflowEvidence } from './cooperative-control.js';

const evidence = (): WorkflowEvidence => ({
  runId: 'run-1', goal: 'Move report to archive', stepIndex: 2,
  steps: [{ id: 's1', name: 'Drag report', status: 'running' }],
  screenshots: [{ id: 'frame-before', capturedAt: 100, ref: 'frame-store:before' }, { id: 'frame-after', capturedAt: 200, ref: 'frame-store:after' }],
  actions: [{ id: 'drag-1', action: 'drag', startedAt: 100, before: { id: 'frame-before', capturedAt: 100, ref: 'frame-store:before' }, after: { id: 'frame-after', capturedAt: 200, ref: 'frame-store:after' }, ok: false, verified: false }],
  tried: ['dragged from report to archive; archive did not change'],
  successCriteria: ['report is visible in archive'],
});
const review = (agent: string, assessment: AgentReview['assessment'], confidence = 0.9): AgentReview => ({
  agent, reviewedScreenshotIds: ['frame-before', 'frame-after'], assessment, confidence,
  rationale: assessment === 'blocked' ? 'Compared before/after frames: target remains in source folder.' : 'Reviewed both frames and the current workflow state.',
  at: 250,
});
const setup = () => {
  let time = 300;
  const control = createCooperativeControl({ initialOwner: 'planner', actionStallMs: 1000, now: () => time });
  return { control, setTime: (v: number) => { time = v; } };
};

describe('cooperative control handoff', () => {
  it('arbitrates two simultaneous requests deterministically using screenshot-backed evidence', () => {
    const { control } = setup();
    const token = control.token();
    expect(control.beginAction('planner', token, 'step-1', 'instant')).toBe(true);
    const a = control.requestTakeover('vision-agent', 'target did not move', evidence(), review('vision-agent', 'blocked', 0.8));
    const b = control.requestTakeover('recovery-agent', 'better route', evidence(), review('recovery-agent', 'better-route', 0.95));
    expect(a.status).toBe('pending');
    expect(b.status).toBe('pending');
    control.completeAction('planner', 'step-1', { ok: false, verified: false });
    expect(control.snapshot().owner).toBe('vision-agent');
    expect(control.snapshot().history.find(x => x.from === 'recovery-agent')?.status).toBe('rejected');
  });

  it('rejects an old controller token after handoff', () => {
    const { control } = setup();
    const old = control.token();
    control.requestTakeover('reviewer', 'blocked', evidence(), review('reviewer', 'blocked'));
    expect(control.canDispatch('planner', old)).toBe(false);
    expect(control.beginAction('planner', old, 'late-click', 'instant')).toBe(false);
  });

  it('pauses and fences an unresponsive drag or typing action', () => {
    const { control, setTime } = setup();
    const token = control.token();
    expect(control.beginAction('planner', token, 'drag-1', 'drag')).toBe(true);
    const req = control.requestTakeover('recovery', 'drag appears hung', evidence(), review('recovery', 'blocked'));
    expect(req.status).toBe('pending');
    setTime(1400);
    expect(control.detectStall()).toBe(true);
    expect(control.snapshot().paused).toBe(true);
    expect(control.canDispatch('planner', token)).toBe(false);
    expect(control.snapshot().owner).toBe('planner');
  });

  it('rejects takeover while current agent has verified progress', () => {
    const { control } = setup();
    const token = control.token();
    control.beginAction('planner', token, 'step', 'instant');
    const req = control.requestTakeover('observer', 'maybe faster', evidence(), review('observer', 'progress'));
    expect(req.status).toBe('pending');
    control.completeAction('planner', 'step', { ok: true, verified: true });
    expect(control.snapshot().owner).toBe('planner');
    expect(control.snapshot().history.find(x => x.id === req.id)).toMatchObject({ status: 'rejected', decision: expect.stringMatching(/verified progress/) });
  });

  it('accepts takeover when current agent cannot reach the goal', () => {
    const { control } = setup();
    const req = control.requestTakeover('recovery', 'planner blocked', evidence(), review('recovery', 'blocked'));
    expect(req.status).toBe('accepted');
    expect(control.snapshot().owner).toBe('recovery');
  });

  it('lets the user take control during a pending transfer and cancels agent requests', () => {
    const { control } = setup();
    const token = control.token();
    control.beginAction('planner', token, 'typing-1', 'typing');
    const req = control.requestTakeover('recovery', 'typing is stuck', evidence(), review('recovery', 'blocked'));
    expect(req.status).toBe('pending');
    control.userTakeControl();
    expect(control.snapshot()).toMatchObject({ owner: 'user', activeAction: null, pending: [] });
    expect(control.snapshot().history.find(x => x.id === req.id)?.status).toBe('cancelled');
    expect(control.canDispatch('planner', token)).toBe(false);
  });

  it('passes the full workflow state and screenshot references to the incoming reviewer', () => {
    const { control } = setup();
    const e = evidence();
    const req = control.requestTakeover('vision-agent', 'need visual recovery', e, review('vision-agent', 'blocked'));
    expect(req.evidence).toEqual(e);
    expect(req.evidence.screenshots.map(s => s.id)).toEqual(['frame-before', 'frame-after']);
    expect(req.evidence.actions[0].before?.ref).toBe('frame-store:before');
    expect(req.evidence.actions[0].after?.ref).toBe('frame-store:after');
  });

  it('shares outcome evidence but learns a reusable skill only after verified success', () => {
    const { control } = setup();
    const e = evidence();
    expect(control.learnFromOutcome({ skill: 'archive by context menu', evidence: e, outcome: 'unverified', reviewer: 'validator' })).toBeNull();
    expect(control.learnFromOutcome({ skill: 'archive by context menu', evidence: e, outcome: 'failed', reviewer: 'validator' })).toBeNull();
    const verified = { ...e, actions: [{ ...e.actions[0], ok: true, verified: true, after: e.screenshots[1] }] };
    expect(control.learnFromOutcome({ skill: 'archive by context menu', evidence: verified, outcome: 'verified-success', reviewer: 'validator' })).toMatchObject({
      skill: 'archive by context menu', provenance: 'verified', screenshotIds: ['frame-before', 'frame-after'],
    });
  });

  it('requires every screenshot in the shared evidence packet to be reviewed', () => {
    const { control } = setup();
    const incomplete = { ...review('reviewer', 'blocked'), reviewedScreenshotIds: ['frame-before'] };
    expect(control.requestTakeover('reviewer', 'blocked', evidence(), incomplete).status).toBe('rejected');
  });
});
