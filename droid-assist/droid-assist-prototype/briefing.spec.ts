import { describe, expect, it } from 'vitest';
import {
  AI_DOWN_NOTE,
  BRIEFING_LIMIT,
  addBriefing,
  briefingIssues,
  buildBriefing,
  compareFrames,
  objectivesOf,
  referenceFor,
  type Briefing,
} from './briefing.js';
import type { CrossCheck, Knowledge } from './cross-reference.js';
import { DEFAULT_DRIFT } from './drift.js';
import type { Proposal } from './proposal.js';
import type { Frame, WorkflowStep } from './types.js';

const W = 320;
const H = 180;

/** A black 320x180 buffer with a white rectangle covering sample pixels [x0,x1) x [y0,y1). */
function imageWith(x0 = 0, x1 = 0, y0 = 0, y1 = 0): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = x >= x0 && x < x1 && y >= y0 && y < y1 ? 255 : 0;
      data.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}

let frameId = 0;
/** A Frame wrapping a black-with-rectangle buffer, for reference/comparison tests. */
function frameWith(x0 = 0, x1 = 0, y0 = 0, y1 = 0): Frame {
  frameId += 1;
  return { id: frameId, time: frameId, url: `data:image/jpeg;base64,F${frameId}`, data: imageWith(x0, x1, y0, y1), srcW: 1920, srcH: 1080, source: 'demo' };
}

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

const knowledge = (over: Partial<Knowledge> = {}): Knowledge => ({ map: [], familiar: [], habits: [], patterns: [], failures: [], context: '', ...over });

const mkBriefing = (over: Partial<Briefing> = {}): Briefing => ({
  id: 'b1',
  time: 0,
  stepId: 's1',
  stepName: 'Click button',
  objectives: objectivesOf('goal', [step()], step(), proposal()),
  comparison: compareFrames(null, null, DEFAULT_DRIFT),
  crossRef: [],
  aiNote: null,
  revisions: [],
  outcome: 'clear',
  ...over,
});

describe('referenceFor', () => {
  it('returns the steps own reference screenshot, anchored at its recorded point', () => {
    const refFrame = frameWith(0, 10, 0, 10);
    const s = step({ refFrame, x: 0.2, y: 0.3 });
    expect(referenceFor([s], s)).toEqual({ frame: refFrame, label: 'saved reference screenshot of this step', anchor: { x: 0.2, y: 0.3 } });
  });

  it('falls back to the latest earlier done steps after-frame, anchored at the planned point', () => {
    const after1 = frameWith(0, 10, 0, 10);
    const after2 = frameWith(10, 20, 10, 20);
    const earlier1 = step({ id: 'a', name: 'First', status: 'done', afterFrame: after1 });
    const earlier2 = step({ id: 'b', name: 'Second', status: 'done', afterFrame: after2 });
    const pending = step({ id: 'c', name: 'Pending', status: 'pending' });
    const s = step({ id: 'd', correctedX: 0.6, x: 0.5, y: 0.7 });
    expect(referenceFor([earlier1, earlier2, pending, s], s)).toEqual({ frame: after2, label: 'verified frame after "Second"', anchor: { x: 0.6, y: 0.7 } });
  });

  it('returns null with no own reference and no earlier verified frame', () => {
    const s = step();
    expect(referenceFor([s], s)).toBeNull();
  });
});

describe('compareFrames', () => {
  const anchor = { x: 0.1, y: 0.1 };
  const refFrame = frameWith();
  const reference = { frame: refFrame, label: 'ref', anchor };

  it('is idle with no live frame', () => {
    const c = compareFrames(null, reference, DEFAULT_DRIFT);
    expect(c).toMatchObject({ live: null, level: 'idle', failed: false });
    expect(c.verdict).toMatch(/no live frame/i);
  });

  it('is idle with no reference frame', () => {
    const live = frameWith();
    const c = compareFrames(live, null, DEFAULT_DRIFT);
    expect(c).toMatchObject({ live, level: 'idle', failed: false });
    expect(c.verdict).toMatch(/no reference frame/i);
  });

  it('is green with no regions when the frames are identical', () => {
    const live = frameWith();
    const c = compareFrames(live, reference, DEFAULT_DRIFT);
    expect(c.level).toBe('green');
    expect(c.regions).toEqual([]);
    expect(c.failed).toBe(false);
  });

  it('boxes a changed region elsewhere without failing', () => {
    const live = frameWith(200, 260, 100, 140);
    const c = compareFrames(live, reference, DEFAULT_DRIFT);
    expect(c.level).toBe('green');
    expect(c.regions).toEqual([{ x: 10 / 16, y: 5 / 9, w: 3 / 16, h: 2 / 9 }]);
    expect(c.failed).toBe(false);
  });

  it('fails red when the target is not found anywhere in the search radius', () => {
    const live = frameWith(0, 320, 0, 180);
    const c = compareFrames(live, reference, DEFAULT_DRIFT);
    expect(c.level).toBe('red');
    expect(c.failed).toBe(true);
  });
});

describe('objectivesOf', () => {
  it('lists the goal, marks only the current step, and takes what/why/x/y/source from the proposal', () => {
    const s1 = step({ id: 'a', name: 'Open app', target: undefined, status: 'done' });
    const s2 = step({ id: 'b', name: 'Click button', target: 'Button', status: 'pending' });
    const p = proposal({ x: 0.33, y: 0.44, what: 'click "Button" at (33%, 44%)', why: 'it confirms the dialog' });
    const o = objectivesOf('finish the task', [s1, s2], s2, p);
    expect(o.goal).toBe('finish the task');
    expect(o.sequence).toEqual([
      { id: 'a', name: 'Open app', action: 'click', target: 'Open app', status: 'done', current: false },
      { id: 'b', name: 'Click button', action: 'click', target: 'Button', status: 'pending', current: true },
    ]);
    expect(o).toMatchObject({ action: 'click', target: 'Button', x: 0.33, y: 0.44, what: p.what, why: p.why, source: 'ai' });
  });
});

describe('buildBriefing', () => {
  it('builds the objectives breakdown and a null aiNote while online', () => {
    const s = step();
    const p = proposal();
    const b = buildBriefing({ goal: 'finish', steps: [s], step: s, proposal: p, live: null, knowledge: knowledge(), thresholds: DEFAULT_DRIFT, online: true });
    expect(b.objectives).toEqual(objectivesOf('finish', [s], s, p));
    expect(b.aiNote).toBeNull();
    expect(b.stepId).toBe(s.id);
    expect(b.stepName).toBe(s.name);
    expect(b.outcome).toBe('clear');
    expect(b.revisions).toEqual([]);
  });

  it('shows the AI-down note while offline, still computing the comparison and cross-reference', () => {
    const live = frameWith();
    const refStep = step({ refFrame: frameWith(), x: 0.5, y: 0.5 });
    const mismatched = { id: 'm1', name: 'Other thing', box: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, mappedAt: 0 };
    const p = proposal();
    const b = buildBriefing({
      goal: 'finish',
      steps: [refStep],
      step: refStep,
      proposal: p,
      live,
      knowledge: knowledge({ map: [mismatched] }),
      thresholds: DEFAULT_DRIFT,
      online: false,
    });
    expect(b.aiNote).toBe(AI_DOWN_NOTE);
    expect(b.comparison.level).not.toBe('idle');
    expect(b.crossRef).toEqual([expect.objectContaining({ source: 'mapped', status: 'conflicting' })]);
  });
});

describe('briefingIssues', () => {
  it('is empty when the comparison passed and nothing conflicts', () => {
    const b = mkBriefing({ comparison: compareFrames(null, null, DEFAULT_DRIFT), crossRef: [] });
    expect(briefingIssues(b)).toEqual([]);
  });

  it('lists the failed comparison and each conflict', () => {
    const failed = { ...compareFrames(null, null, DEFAULT_DRIFT), failed: true, verdict: 'RED — not found' };
    const crossRef: CrossCheck[] = [
      { source: 'habit', status: 'conflicting', text: 'Habit X unreliable' },
      { source: 'mapped', status: 'consistent', text: 'Mapped Y matches' },
    ];
    const b = mkBriefing({ comparison: failed, crossRef });
    expect(briefingIssues(b)).toEqual(['comparison failed: RED — not found', 'conflict: Habit X unreliable']);
  });
});

describe('addBriefing', () => {
  it('adds newest first', () => {
    const b1 = mkBriefing({ id: '1' });
    const b2 = mkBriefing({ id: '2' });
    expect(addBriefing([b1], b2).map((b) => b.id)).toEqual(['2', '1']);
  });

  it('replaces an earlier record with the same id', () => {
    const b1 = mkBriefing({ id: '1', stepName: 'Old' });
    const updated = mkBriefing({ id: '1', stepName: 'New' });
    const list = addBriefing([b1], updated);
    expect(list).toHaveLength(1);
    expect(list[0].stepName).toBe('New');
  });

  it('keeps at most BRIEFING_LIMIT', () => {
    let list: Briefing[] = [];
    for (let i = 0; i < BRIEFING_LIMIT + 5; i++) list = addBriefing(list, mkBriefing({ id: `b${i}` }));
    expect(list).toHaveLength(BRIEFING_LIMIT);
    expect(list[0].id).toBe(`b${BRIEFING_LIMIT + 4}`);
  });
});
