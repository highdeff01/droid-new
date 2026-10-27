import { describe, expect, it, vi } from 'vitest';
import { reviewBriefing, type ReviewDeps } from './briefing-review.js';
import type { Briefing, FrameComparison, Objectives } from './briefing.js';
import type { Proposal } from './proposal.js';
import type { Frame, WorkflowStep } from './types.js';

const idleComparison: FrameComparison = { live: null, reference: null, referenceLabel: 'none', regions: [], changedCells: 0, distance: 0, level: 'idle', failed: false, verdict: 'nothing to compare' };
const failedComparison: FrameComparison = { ...idleComparison, failed: true, level: 'red', verdict: 'RED — not found' };

const fakeImage = (): ImageData => ({ width: 1, height: 1, data: new Uint8ClampedArray(4), colorSpace: 'srgb' } as ImageData);
const fakeFrame = (id: number): Frame => ({ id, time: id, url: `data:image/jpeg;base64,F${id}`, data: fakeImage(), srcW: 100, srcH: 100, source: 'demo' });

const step = (over: Partial<WorkflowStep> = {}): WorkflowStep => ({ id: 's1', name: 'Click button', action: 'click', target: 'Button', x: 0.5, y: 0.5, status: 'pending', ...over });

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  ready: true,
  action: 'click',
  target: 'Button',
  x: 0.5,
  y: 0.5,
  what: 'click "Button" at (50%, 50%)',
  why: 'it confirms the dialog',
  source: 'ai',
  thinking: null,
  ...over,
});

const objectivesOf = (s: WorkflowStep, p: Proposal): Objectives => ({
  goal: 'goal',
  sequence: [{ id: s.id, name: s.name, action: s.action, target: s.target ?? s.name, status: s.status, current: true }],
  action: p.action,
  target: p.target,
  x: p.x,
  y: p.y,
  what: p.what,
  why: p.why,
  source: p.source,
});

function briefingFor(s: WorkflowStep, p: Proposal, over: Partial<Briefing> = {}): Briefing {
  return {
    id: 'brief-1',
    time: 0,
    stepId: s.id,
    stepName: s.name,
    objectives: objectivesOf(s, p),
    comparison: idleComparison,
    crossRef: [],
    aiNote: null,
    revisions: [],
    outcome: 'clear',
    ...over,
  };
}

const baseDeps = (): ReviewDeps => ({
  online: true,
  groundingOn: true,
  hasBaseline: false,
  recalibrate: vi.fn(),
  reground: vi.fn(async () => null),
  replan: vi.fn(async () => null),
  rebuild: vi.fn(),
  publish: vi.fn(),
});

describe('reviewBriefing — clear path', () => {
  it('is clear and calls no deps when the briefing has no issues', async () => {
    const s = step();
    const p = proposal();
    const briefing = briefingFor(s, p);
    const deps = baseDeps();
    const result = await reviewBriefing({ briefing, step: s, proposal: p }, deps);
    expect(result.briefing.outcome).toBe('clear');
    expect(deps.recalibrate).not.toHaveBeenCalled();
    expect(deps.reground).not.toHaveBeenCalled();
    expect(deps.replan).not.toHaveBeenCalled();
    expect(deps.rebuild).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });
});

describe('reviewBriefing — recalibrate-before-apply', () => {
  it('rescales the step and moves the proposal, recording one recalibrate revision before publishing once', async () => {
    const s = step();
    const p = proposal();
    const briefing = briefingFor(s, p, { comparison: failedComparison });
    const rescaledStep = step({ x: 0.6, y: 0.65 });
    const cleanBriefing = briefingFor(rescaledStep, proposal({ x: 0.6, y: 0.65 }));
    const deps: ReviewDeps = {
      ...baseDeps(),
      hasBaseline: true,
      recalibrate: vi.fn(() => ({ drift: true, detail: 'moved 2%', step: rescaledStep })),
      rebuild: vi.fn(() => cleanBriefing),
    };
    const result = await reviewBriefing({ briefing, step: s, proposal: p }, deps);
    expect(deps.recalibrate).toHaveBeenCalledTimes(1);
    expect(deps.reground).not.toHaveBeenCalled();
    expect(deps.replan).not.toHaveBeenCalled();
    expect(deps.rebuild).toHaveBeenCalledTimes(1);
    expect(deps.publish).toHaveBeenCalledTimes(1);
    expect(result.step).toBe(rescaledStep);
    expect(result.proposal.x).toBe(0.6);
    expect(result.proposal.y).toBe(0.65);
    expect(result.briefing.revisions.map((r) => r.kind)).toEqual(['recalibrate']);
    expect(result.briefing.id).toBe('brief-1');
    expect(result.briefing.outcome).toBe('corrected');
  });
});

describe('reviewBriefing — reground', () => {
  it('re-points the step at the regrounded point and drops its refFrame', async () => {
    const s = step({ refFrame: fakeFrame(1) });
    const p = proposal();
    const briefing = briefingFor(s, p, { comparison: failedComparison });
    const cleanBriefing = briefingFor(step({ x: 0.8, y: 0.3 }), proposal({ x: 0.8, y: 0.3 }));
    const deps: ReviewDeps = {
      ...baseDeps(),
      hasBaseline: false,
      reground: vi.fn(async () => ({ x: 0.8, y: 0.3 })),
      rebuild: vi.fn(() => cleanBriefing),
    };
    const result = await reviewBriefing({ briefing, step: s, proposal: p }, deps);
    expect(result.step.x).toBe(0.8);
    expect(result.step.y).toBe(0.3);
    expect(result.step.refFrame).toBeUndefined();
    expect(result.briefing.revisions.map((r) => r.kind)).toEqual(['reground']);
    expect(result.briefing.outcome).toBe('corrected');
  });

  it('falls back to replan when reground finds nothing', async () => {
    const s = step();
    const p = proposal();
    const briefing = briefingFor(s, p, { comparison: failedComparison });
    const stillFailing = briefingFor(s, p, { comparison: failedComparison });
    const replannedStep = step({ x: 0.7, y: 0.2 });
    const replannedProposal = proposal({ x: 0.7, y: 0.2, what: 'click "Button" at (70%, 20%)' });
    const cleanBriefing = briefingFor(replannedStep, replannedProposal);
    const rebuild = vi.fn().mockReturnValueOnce(stillFailing).mockReturnValueOnce(cleanBriefing);
    const deps: ReviewDeps = {
      ...baseDeps(),
      hasBaseline: false,
      reground: vi.fn(async () => null),
      replan: vi.fn(async () => ({ step: replannedStep, proposal: replannedProposal })),
      rebuild,
    };
    const result = await reviewBriefing({ briefing, step: s, proposal: p }, deps);
    expect(deps.reground).toHaveBeenCalledTimes(1);
    expect(deps.replan).toHaveBeenCalledTimes(1);
    expect(rebuild).toHaveBeenCalledTimes(2);
    expect(result.step).toBe(replannedStep);
    expect(result.proposal).toBe(replannedProposal);
    expect(result.briefing.revisions.map((r) => r.kind)).toEqual(['reground', 'replan']);
    expect(result.briefing.outcome).toBe('corrected');
  });
});

describe('reviewBriefing — unresolved', () => {
  it('stays unresolved offline with no baseline, attempting no recalibration, grounding or replanning', async () => {
    const s = step();
    const p = proposal();
    const briefing = briefingFor(s, p, { comparison: failedComparison });
    const deps: ReviewDeps = { ...baseDeps(), online: false, hasBaseline: false };
    const result = await reviewBriefing({ briefing, step: s, proposal: p }, deps);
    expect(deps.recalibrate).not.toHaveBeenCalled();
    expect(deps.reground).not.toHaveBeenCalled();
    expect(deps.replan).not.toHaveBeenCalled();
    expect(deps.rebuild).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
    expect(result.briefing.outcome).toBe('unresolved');
    expect(result.step).toBe(s);
    expect(result.proposal).toBe(p);
  });
});
