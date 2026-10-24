import { afterEach, describe, expect, it, vi } from 'vitest';
import { runStep, type StepDeps } from './run-step.js';
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
