import { afterEach, describe, expect, it, vi } from 'vitest';
import { runStep, type Grounding, type StepDeps } from './run-step.js';
import type { Frame, WorkflowStep } from './types.js';

const W = 320;
const H = 180;

function image(cx: number, cy: number): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = Math.abs(x - cx) < 6 && Math.abs(y - cy) < 6 ? 240 : x - cx >= 6 && x - cx < 10 && Math.abs(y - cy) < 3 ? 140 : 20;
      data.set([v, v, v, 255], i);
    }
  }
  return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}

const frame = (id: number, data: ImageData): Frame => ({ id, time: 0, url: `shot-${id}`, data, srcW: 1920, srcH: 1080, source: 'desktop' });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const step: WorkflowStep = { id: 's', name: 'Press play', action: 'click', x: 100 / W, y: 60 / H, refFrame: frame(0, image(100, 60)), status: 'pending' };

function deps(frames: Frame[], patch: Partial<StepDeps> = {}) {
  const lines: string[] = [];
  const queue = [...frames];
  const d: StepDeps = {
    bridgeUrl: 'http://pc',
    capture: async () => queue.shift() ?? frames[frames.length - 1],
    attempts: 2,
    retryMs: 1,
    dispatch: true,
    log: (m) => lines.push(m),
    ...patch,
  };
  return { d, lines };
}

const completedRun = () => vi.fn()
  .mockResolvedValueOnce(json({ success: true, run: { id: 'r', status: 'running' } }))
  .mockResolvedValueOnce(json({ success: true, run: { id: 'r', status: 'completed' } }));

afterEach(() => vi.unstubAllGlobals());

describe('runStep', () => {
  it('executes at the drift-corrected position, logs the drift in pixels and re-verifies', async () => {
    const fetchSpy = completedRun();
    vi.stubGlobal('fetch', fetchSpy);
    const { d, lines } = deps([frame(1, image(110, 66)), frame(2, image(200, 120))]);
    const out = await runStep(step, d);
    expect(out.ok && out.executed).toBe(true);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).steps[0]).toMatchObject({ action: 'click', x: 660, y: 396 });
    expect(lines.some((l) => /drift 70px .*corrected by \(\+60, \+36\)px/.test(l))).toBe(true);
    expect(lines.some((l) => /re-verified — screen changed/.test(l))).toBe(true);
    expect(out.shot?.url).toBe('shot-2');
  });

  it('never dispatches when the target is not found on the live screen', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const blank = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255), colorSpace: 'srgb' } as ImageData;
    const { d } = deps([frame(1, blank)]);
    const out = await runStep(step, d);
    expect(out).toMatchObject({ ok: false, executed: false });
    expect(out.message).toMatch(/not found .* not executed/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails with the bridge error when there is no live screen', async () => {
    const { d } = deps([], { capture: async () => { throw new Error('Desktop bridge not connected — connect the bridge'); } });
    const out = await runStep(step, d);
    expect(out).toMatchObject({ ok: false, executed: false });
    expect(out.message).toMatch(/connect the bridge/);
  });

  it('self-test verifies but sends no input', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { d } = deps([frame(1, image(100, 60))], { dispatch: false });
    const out = await runStep(step, d);
    expect(out).toMatchObject({ ok: true, executed: false });
    expect(out.message).toMatch(/not dispatched/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('logs a missing visible change after the action', async () => {
    vi.stubGlobal('fetch', completedRun());
    const same = frame(1, image(100, 60));
    const { d, lines } = deps([same, same]);
    const out = await runStep(step, d);
    expect(out.executed).toBe(true);
    expect(lines.some((l) => /no visible change/.test(l))).toBe(true);
  });
});

describe('runStep grounding', () => {
  const live = frame(1, image(100, 60));
  const move: WorkflowStep = { id: 'm', name: 'Move to Files icon', action: 'move', target: 'Files icon', x: 0.25, y: 0.5, status: 'pending' };
  const seen = (visible: boolean, reason = visible ? 'icon is there' : 'empty desktop') => ({ visible, reason, thinking: null });
  const grounding = (confirm: Grounding['confirm'], relocate: Grounding['relocate'] = vi.fn(async () => null)): Grounding => ({ confirm, relocate });
  const sentStep = (fetchSpy: ReturnType<typeof vi.fn>) => JSON.parse(fetchSpy.mock.calls[0][1].body).steps[0];

  it('dispatches a real cursor move at a confirmed target', async () => {
    const fetchSpy = completedRun();
    vi.stubGlobal('fetch', fetchSpy);
    const { d } = deps([live], { grounding: grounding(vi.fn(async () => seen(true))) });
    const out = await runStep(move, d);
    expect(out).toMatchObject({ ok: true, executed: true });
    const sent = sentStep(fetchSpy);
    expect(sent).toMatchObject({ action: 'move', x: 480, y: 540 });
    expect(sent.durationMs).toBeGreaterThanOrEqual(250);
    expect(sent.durationMs).toBeLessThanOrEqual(550);
  });

  it('re-asks the planner once and dispatches at the confirmed new point', async () => {
    const fetchSpy = completedRun();
    vi.stubGlobal('fetch', fetchSpy);
    const confirm = vi.fn<Grounding['confirm']>().mockResolvedValueOnce(seen(false)).mockResolvedValueOnce(seen(true));
    const relocate = vi.fn<Grounding['relocate']>(async () => ({ x: 0.5, y: 0.75 }));
    const { d } = deps([live], { grounding: grounding(confirm, relocate) });
    const out = await runStep({ ...move, action: 'double_click' }, d);
    expect(out.executed).toBe(true);
    expect(relocate).toHaveBeenCalledTimes(1);
    expect(relocate.mock.calls[0][2]).toContain('empty desktop');
    expect(confirm.mock.calls[1][2]).toEqual({ x: 0.5, y: 0.75 });
    expect(sentStep(fetchSpy)).toMatchObject({ action: 'double_click', x: 960, y: 810 });
  });

  it('never dispatches when the re-planned point is rejected too', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { d } = deps([live], { grounding: grounding(vi.fn(async () => seen(false)), vi.fn(async () => ({ x: 0.5, y: 0.75 }))) });
    const out = await runStep(move, d);
    expect(out).toMatchObject({ ok: false, executed: false });
    expect(out.message).toMatch(/^Target "Files icon" not located/);
    expect(out.message).toContain('(480, 540)px');
    expect(out.message).toContain('(960, 810)px');
    expect(out.message).toMatch(/not executed$/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never dispatches when the re-plan cannot see the target', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { d } = deps([live], { grounding: grounding(vi.fn(async () => seen(false))) });
    const out = await runStep(move, d);
    expect(out.executed).toBe(false);
    expect(out.message).toMatch(/re-plan found no such target/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never dispatches when the AI check fails', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { d } = deps([live], { grounding: grounding(vi.fn(async () => { throw new Error('model offline'); })) });
    const out = await runStep({ ...move, action: 'scroll', text: 'down' }, d);
    expect(out.executed).toBe(false);
    expect(out.message).toMatch(/could not be verified/);
    expect(out.message).toContain('model offline');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a red template match before asking the AI', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const confirm = vi.fn(async () => seen(true));
    const blank = frame(2, image(-50, -50));
    const { d } = deps([blank], { grounding: grounding(confirm) });
    const out = await runStep({ ...step, target: 'Play button' }, d);
    expect(out.executed).toBe(false);
    expect(out.message).toMatch(/not found on the live screen.*best match/);
    expect(confirm).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips the AI pass for a step without a named target', async () => {
    vi.stubGlobal('fetch', completedRun());
    const confirm = vi.fn(async () => seen(false));
    const { d } = deps([live], { grounding: grounding(confirm) });
    const out = await runStep({ ...move, target: undefined }, d);
    expect(out.executed).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('drag grounding of both points', () => {
  /** Two distinct bright squares on one frame, so a drag's start and end are each a locatable template. */
  function dragImage(x1: number, y1: number, x2: number, y2: number): ImageData {
    const data = new Uint8ClampedArray(W * H * 4);
    const onSquare = (cx: number, cy: number, x: number, y: number) => Math.abs(x - cx) < 6 && Math.abs(y - cy) < 6;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const v = onSquare(x1, y1, x, y) || onSquare(x2, y2, x, y) ? 240 : 20;
        data.set([v, v, v, 255], i);
      }
    }
    return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
  }

  const START = { x: 100, y: 60 };
  const END = { x: 220, y: 120 };

  /** A drag WorkflowStep whose start and end are each a distinct bright square in its reference frame. */
  function dragStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
    return {
      id: 'drag1',
      name: 'Drag Files below Game',
      action: 'drag',
      x: START.x / W,
      y: START.y / H,
      endX: END.x / W,
      endY: END.y / H,
      target: 'Files icon',
      endTarget: 'empty space below Game',
      refFrame: frame(0, dragImage(START.x, START.y, END.x, END.y)),
      status: 'pending',
      ...overrides,
    };
  }

  const seen = (visible: boolean, reason = visible ? 'icon is there' : 'empty desktop') => ({ visible, reason, thinking: null });
  const grounding = (confirm: Grounding['confirm'], relocate: Grounding['relocate'] = vi.fn(async () => null)): Grounding => ({ confirm, relocate });
  const sentStep = (fetchSpy: ReturnType<typeof vi.fn>) => JSON.parse(fetchSpy.mock.calls[0][1].body).steps[0];

  it('confirms the start then the end (with the endTarget as its target) and sends the confirmed end in native pixels', async () => {
    const fetchSpy = completedRun();
    vi.stubGlobal('fetch', fetchSpy);
    const live = frame(1, dragImage(START.x, START.y, END.x, END.y));
    const confirm = vi.fn<Grounding['confirm']>(async () => seen(true));
    const { d } = deps([live], { grounding: grounding(confirm) });
    const step = dragStep();
    const out = await runStep(step, d);
    expect(out).toMatchObject({ ok: true, executed: true });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[0][1].target).toBe(step.target);
    expect(confirm.mock.calls[1][1].target).toBe(step.endTarget);
    const sent = sentStep(fetchSpy);
    expect(sent.endX).toBe(Math.round(step.endX! * 1920));
    expect(sent.endY).toBe(Math.round(step.endY! * 1080));
  });

  it('never dispatches when confirm rejects the end point and the re-plan finds nothing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const live = frame(1, dragImage(START.x, START.y, END.x, END.y));
    const confirm = vi.fn().mockResolvedValueOnce(seen(true)).mockResolvedValueOnce(seen(false));
    const relocate = vi.fn(async () => null);
    const { d } = deps([live], { grounding: grounding(confirm, relocate) });
    const out = await runStep(dragStep(), d);
    expect(out).toMatchObject({ ok: false, executed: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('drift-corrects the end point when the live frame is shifted', async () => {
    const shiftX = 10;
    const shiftY = 6;
    const live = frame(1, dragImage(START.x + shiftX, START.y + shiftY, END.x + shiftX, END.y + shiftY));
    const { d } = deps([live], { dispatch: false });
    const step = dragStep();
    const out = await runStep(step, d);
    expect(out.end!.x - step.endX!).toBeCloseTo(shiftX / W, 2);
    expect(out.end!.y - step.endY!).toBeCloseTo(shiftY / H, 2);
  });
});
