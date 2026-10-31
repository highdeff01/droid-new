import { describe, expect, it } from 'vitest';
import { REPLAY_LIMIT, advanceSnapshot, fromResumePayload, isResumable, newSnapshot, resumeLine, resumePlan, toResumePayload } from './session-resume.js';

describe('newSnapshot / advanceSnapshot', () => {
  it('starts at step 0 with an empty replay', () => {
    const s = newSnapshot('r1', 'open settings', ['a', 'b'], 100);
    expect(s).toMatchObject({ runId: 'r1', goal: 'open settings', steps: ['a', 'b'], activeIndex: 0, replay: [], at: 100 });
  });

  it('advances the index and appends replay lines, capped', () => {
    let s = newSnapshot('r1', 'g', ['a']);
    for (let i = 0; i < REPLAY_LIMIT + 5; i++) s = advanceSnapshot(s, i, `line ${i}`);
    expect(s.activeIndex).toBe(REPLAY_LIMIT + 4);
    expect(s.replay).toHaveLength(REPLAY_LIMIT);
    expect(s.replay[REPLAY_LIMIT - 1]).toBe(`line ${REPLAY_LIMIT + 4}`);
  });
});

describe('payload round trip', () => {
  it('survives the wire with the arrival time stamped', () => {
    const s = advanceSnapshot(newSnapshot('r1', 'g', ['a', 'b'], 5), 1, 'clicked a', 6);
    expect(fromResumePayload(toResumePayload(s), 99)).toEqual({ ...s, at: 99 });
  });
});

describe('resumePlan', () => {
  it('replays only what the restarted app had not seen', () => {
    const s = { runId: 'r1', goal: 'g', steps: ['a', 'b'], activeIndex: 1, replay: ['x', 'y', 'z'], at: 1 };
    const plan = resumePlan(s, 1);
    expect(plan.replay).toEqual(['y', 'z']);
    expect(plan.resumeAt).toBe(1);
    expect(plan.summary).toContain('step 2');
  });

  it('clamps the resume point into the plan', () => {
    expect(resumePlan({ runId: 'r', goal: 'g', steps: ['a', 'b'], activeIndex: 9, replay: [], at: 1 }).resumeAt).toBe(1);
    expect(resumePlan({ runId: 'r', goal: 'g', steps: ['a', 'b'], activeIndex: -3, replay: [], at: 1 }).resumeAt).toBe(0);
  });

  it('handles a plan with no steps', () => {
    expect(resumePlan({ runId: 'r', goal: 'g', steps: [], activeIndex: 0, replay: [], at: 1 }).resumeAt).toBe(0);
  });
});

describe('isResumable', () => {
  it('is false for null, an empty plan and a finished run', () => {
    expect(isResumable(null)).toBe(false);
    expect(isResumable(newSnapshot('r', 'g', []))).toBe(false);
    expect(isResumable({ runId: 'r', goal: 'g', steps: ['a'], activeIndex: 1, replay: [], at: 1 })).toBe(false);
  });

  it('is true for a run still in progress', () => {
    expect(isResumable({ runId: 'r', goal: 'g', steps: ['a', 'b'], activeIndex: 1, replay: [], at: 1 })).toBe(true);
  });
});

describe('resumeLine', () => {
  it('summarises the snapshot', () => {
    expect(resumeLine({ runId: 'r', goal: 'g', steps: ['a', 'b'], activeIndex: 1, replay: ['x'], at: 1 })).toBe('Run "g" snapshot: 1/2 step(s), 1 replay line(s)');
  });
});
