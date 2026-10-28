import { describe, expect, it, vi } from 'vitest';
import { NO_SUMMARY, assessChange, changeText, detectChange, type ChangeAssessment } from './screen-change.js';
import { localProposal, proposalText, proposeStep } from './proposal.js';
import { AiError } from './ai.js';
import type { AskFn } from './ai.js';
import type { Frame, WorkflowStep } from './types.js';

const W = 320;
const H = 180;

/** A black frame with a white rectangle covering sample pixels [x0,x1) × [y0,y1). */
function frameWith(x0 = 0, x1 = 0, y0 = 0, y1 = 0): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = x >= x0 && x < x1 && y >= y0 && y < y1 ? 255 : 0;
      data.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}

const askReturning = (text: string, thinking: string | null = null) => vi.fn<AskFn>(async () => ({ content: text, thinking }));
const full = { id: 1, url: 'data:image/jpeg;base64,RlVMTA==' } as Frame;
const crop = { id: 1, url: 'data:image/jpeg;base64,Q1JPUA==' } as Frame;
const change = { box: { x: 0.25, y: 0.25, w: 0.25, h: 0.33 }, cells: 12 };
const step: WorkflowStep = { id: 's', name: 'Press play', action: 'click', target: 'Play button', x: 0.5, y: 0.6, status: 'pending' };
const navigated: ChangeAssessment = { kind: 'navigation', summary: 'the Settings page', stale: true, effect: 'Play is gone', thinking: null };

describe('detectChange', () => {
  // A 3×3-cell block of the 16×9 grid (cells are 20×20 sample pixels).
  const block = frameWith(80, 140, 40, 100);

  it('reports the bounding box of a cluster at least the threshold in size', () => {
    expect(detectChange(frameWith(), block, 6)).toEqual({ box: { x: 4 / 16, y: 2 / 9, w: 3 / 16, h: 3 / 9 }, cells: 9 });
  });

  it('ignores a cluster below the tunable threshold and an unchanged frame', () => {
    expect(detectChange(frameWith(), block, 10)).toBeNull();
    expect(detectChange(block, block, 2)).toBeNull();
  });
});

describe('assessChange', () => {
  it('sends the boxed frame plus the zoomed crop with the plan and parses the assessment', async () => {
    const ask = askReturning('{"kind":"dialog","summary":"a Save dialog","stale":true,"effect":"it covers Play"}', 'A dialog opened.');
    const a = await assessChange(ask, full, crop, change, { goal: 'play the video', next: '"Press play" — click' });
    expect(a).toEqual({ kind: 'dialog', summary: 'a Save dialog', stale: true, effect: 'it covers Play', thinking: 'A dialog opened.' });
    const req = ask.mock.calls[0][0];
    expect(req.frame).toBe(full);
    expect(req.crops).toEqual([crop]);
    expect(req.prompt).toMatch(/x=25%\.\.50%/);
    expect(req.prompt).toMatch(/Goal: play the video/);
    expect(req.prompt).toMatch(/Next planned step: "Press play"/);
  });

  it('reads an unknown kind as other and a missing stale as not stale', async () => {
    const a = await assessChange(askReturning('{"kind":"weird","summary":"new text loaded"}'), full, crop, change, { goal: '', next: null });
    expect(a).toMatchObject({ kind: 'other', stale: false, effect: '' });
  });

  it('states plainly that no summary could be produced when the reply has none', async () => {
    const a = await assessChange(askReturning('{"kind":"error","summary":"  ","stale":true}'), full, crop, change, { goal: '', next: null });
    expect(a).toMatchObject({ kind: 'error', summary: NO_SUMMARY, stale: true });
    expect(changeText(a)).toBe(`[error] ${NO_SUMMARY} — PLAN STALE`);
  });

  it('summarises an assessment in one line', () => {
    expect(changeText(navigated)).toBe('[navigation] the Settings page — PLAN STALE: Play is gone');
  });
});

describe('proposeStep', () => {
  it('states what (action, target, current coordinates) and why, referencing the screen change', async () => {
    const ask = askReturning('{"ready":true,"x":0.3,"y":0.4,"why":"it starts the video"}', 'Play moved.');
    const p = await proposeStep(ask, full, step, { goal: 'play the video', change: navigated, patterns: ['[Learned avoid] clicking ads'] });
    expect(p).toMatchObject({ ready: true, action: 'click', target: 'Play button', x: 0.3, y: 0.4, source: 'ai', thinking: 'Play moved.' });
    expect(p.what).toBe('click "Play button" at (30%, 40%)');
    expect(p.why).toBe('The screen now shows the Settings page, so I will click "Play button" at (30%, 40%): it starts the video');
    const { prompt } = ask.mock.calls[0][0];
    expect(prompt).toMatch(/changed since the plan: the Settings page/);
    expect(prompt).toMatch(/\[Learned avoid\] clicking ads/);
    expect(prompt).not.toMatch(/RE-PROPOSAL/);
  });

  it('marks a re-proposal and keeps the planned point for a non-pointer step', async () => {
    const ask = askReturning('{"ready":false,"x":0.9,"y":0.9,"why":"no text field is visible"}');
    const typing: WorkflowStep = { ...step, action: 'type', text: 'cats', target: 'search box' };
    const p = await proposeStep(ask, full, typing, { goal: '', change: null, patterns: [], redo: 'the drift monitor reports RED' });
    expect(p).toMatchObject({ ready: false, x: 0.5, y: 0.6, what: 'type "search box" with "cats"', why: 'no text field is visible' });
    expect(ask.mock.calls[0][0].prompt).toMatch(/RE-PROPOSAL: the drift monitor reports RED/);
  });

  it('rejects a proposal without a why', async () => {
    await expect(proposeStep(askReturning('{"ready":true}'), full, step, { goal: '', change: null, patterns: [] })).rejects.toBeInstanceOf(AiError);
  });
});

describe('localProposal / proposalText', () => {
  it('builds the planned what with a stated why', () => {
    const p = localProposal({ ...step, correctedX: 0.52 }, 'AI offline');
    expect(p).toMatchObject({ ready: true, source: 'local', x: 0.52, y: 0.6, what: 'click "Play button" at (52%, 60%)', why: 'AI offline', thinking: null });
    expect(proposalText(p)).toBe('WHAT: click "Play button" at (52%, 60%) · WHY: AI offline');
  });

  it('flags a not-ready proposal', () => {
    expect(proposalText({ ...localProposal(step, 'x'), ready: false })).toMatch(/^NOT READY — WHAT:/);
  });
});
