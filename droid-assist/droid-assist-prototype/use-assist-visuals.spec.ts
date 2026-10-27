import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssist } from './use-assist.js';
import type { NativeCaptureApi, NativeFrame } from './electron/capture-api.js';
import type { WorkflowStep } from './types.js';

// jsdom has no canvas: the boxed full frame and zoomed crop are the frame itself here.
vi.mock('./grounding.js', async (orig) => ({ ...(await orig<typeof import('./grounding.js')>()), boxedFrames: vi.fn(async (f: unknown) => ({ full: f, crop: f })) }));

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

type Engine = { current: ReturnType<typeof useAssist> };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete window.droidNative;
  localStorage.clear();
});

const at = (x: number, y: number) => expect.objectContaining({ x, y });

describe('AI visual presence during runs (demo desktop, AI offline)', () => {
  // PLAY sits at (0.5±0.05, 0.62) on the demo, so a click there really lands when armed.
  const click: WorkflowStep = { id: 'c', name: 'Press play', action: 'click', x: 0.5, y: 0.62, status: 'pending' };
  const type: WorkflowStep = { id: 't', name: 'Type hi', action: 'type', text: 'hi', x: 0.5, y: 0.5, status: 'pending' };
  const move: WorkflowStep = { id: 'm', name: 'Hover', action: 'move', x: 0.2, y: 0.3, status: 'pending' };
  const drag: WorkflowStep = { id: 'd', name: 'Drag', action: 'drag', x: 0.3, y: 0.4, endX: 0.7, endY: 0.45, status: 'pending' };

  async function replayed(steps: WorkflowStep[], armed: boolean): Promise<Engine> {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    if (armed) act(() => result.current.toggleArmed());
    act(() => result.current.setSteps(steps));
    await act(() => result.current.replay(false));
    return result;
  }

  it('a disarmed replay animates the cursor along a path and leaves click and typing markers', async () => {
    const result = await replayed([click, type, move], false);
    const { trail, cursor, log, history } = result.current;
    expect(history).toHaveLength(0);
    expect(log.filter((l) => /dry run — not dispatched/.test(l.message)).length).toBeGreaterThanOrEqual(3);
    expect(trail.filter((p) => p.click)).toEqual([at(0.5, 0.62)]);
    expect(trail.filter((p) => p.typed)).toEqual([at(0.5, 0.62)]);
    expect(trail.filter((p) => !p.click && !p.typed).length).toBeGreaterThanOrEqual(24);
    expect(cursor).toEqual({ x: 0.2, y: 0.3 });
  }, 20_000);

  it('an armed replay shows the same cursor, path and markers as the dry run', async () => {
    const strip = (r: Engine) => ({ cursor: r.current.cursor, marks: r.current.trail.filter((p) => p.click || p.typed).map(({ x, y, click: c, typed }) => ({ x, y, c, typed })), path: r.current.trail.filter((p) => !p.click && !p.typed).length });
    const dry = strip(await replayed([click, type, move], false));
    const real = strip(await replayed([click, type, move], true));
    expect(real.cursor).toEqual(dry.cursor);
    expect(real.marks).toEqual(dry.marks);
    expect(real.path).toBeGreaterThanOrEqual(24);
    expect(dry.path).toBeGreaterThanOrEqual(24);
  }, 30_000);

  it('a drag travels from its start to its drop point with a click dot at each end', async () => {
    const result = await replayed([drag], false);
    const { trail, cursor } = result.current;
    expect(trail.filter((p) => p.click)).toEqual([at(0.3, 0.4), at(0.7, 0.45)]);
    const iEnd = trail.findIndex((p) => p.click && p.x === 0.7);
    expect(trail.slice(trail.findIndex((p) => p.click) + 1, iEnd).length).toBeGreaterThanOrEqual(10);
    expect(cursor).toEqual({ x: 0.7, y: 0.45 });
  }, 20_000);

  it('the trail toggle off still lets the cursor move (only the drawing is hidden)', async () => {
    localStorage.setItem('droid-assist.settings', JSON.stringify({ showTrail: false }));
    const result = await replayed([move], false);
    expect(result.current.settings.showTrail).toBe(false);
    expect(result.current.cursor).toEqual({ x: 0.2, y: 0.3 });
  }, 20_000);
});

/** A model: ping, ready proposals, step reviews, verdicts, goal checks in order and continuation plans. */
function model(checks: Array<{ complete: boolean; progress: boolean; reason: string }>) {
  const bodies: string[] = [];
  let plans = 0;
  const answer = (body: string): string => {
    if (body.includes('Reply with OK')) return 'OK';
    if (body.includes('verifying whether the user')) return JSON.stringify(checks.length > 1 ? checks.shift() : checks[0]);
    // A measure step runs on any screen source without the bridge (it sends no input).
    if (body.includes('This is a continuation')) return JSON.stringify({ steps: [{ name: `Measure ${10 + plans++}`, action: 'measure', text: 'gap', x: 0.5, y: 0.5 }] });
    if (body.includes('state WHAT')) return '{"ready":true,"x":0.5,"y":0.5,"why":"the sum serves the goal"}';
    if (body.includes('final verdict')) return '{"success":true,"pattern_avoid":null,"pattern_add":null}';
    if (body.includes('reviewing a step')) return 'Fine.';
    return '{"patterns":[]}';
  };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = String(init.body);
    bodies.push(body);
    return new Response(JSON.stringify({ message: { role: 'assistant', content: answer(body) } }), { status: 200 });
  }));
  return { bodies, verifies: () => bodies.filter((b) => b.includes('verifying whether the user')), plans: () => plans };
}

const calc: WorkflowStep = { id: 's1', name: 'Calc 1', action: 'calc', text: '1+1', x: 0.5, y: 0.5, status: 'pending' };
const measure: WorkflowStep = { id: 's1', name: 'Measure 1', action: 'measure', text: 'gap', x: 0.5, y: 0.5, status: 'pending' };

describe('auto-continue by default', () => {
  it('replay loops on fresh settings with no goal text, verifying a goal derived from the plan', async () => {
    const m = model([{ complete: false, progress: true, reason: 'one more' }, { complete: true, progress: true, reason: 'all done' }]);
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    expect(result.current.settings.autoContinue).toBe(true);
    act(() => result.current.setSteps([calc]));
    await act(() => result.current.replay(false));
    expect(m.verifies()).toHaveLength(2);
    expect(m.plans()).toBe(1);
    expect(m.verifies()[0]).toContain('Complete the plan: calc');
    expect(result.current.log.find((l) => l.source === 'Auto-continue' && l.message.startsWith('Stopped'))?.message).toMatch(/Goal verified complete — all done/);
  });

  it('a saved explicit off keeps replay to one pass', async () => {
    const m = model([{ complete: false, progress: true, reason: 'x' }]);
    localStorage.setItem('droid-assist.settings', JSON.stringify({ autoContinue: false }));
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => result.current.setSteps([calc]));
    await act(() => result.current.replay(false));
    expect(m.verifies()).toHaveLength(0);
  });
});

describe('Auto Act continuation', () => {
  const frame = (): NativeFrame => ({ time: Date.now(), url: 'data:image/jpeg;base64,AA', pixels: new Uint8Array(320 * 180 * 4), srcW: 1920, srcH: 1080 });

  async function autoActing(settings: Record<string, unknown> = {}) {
    const hooks: { onFrame?: (f: NativeFrame) => void } = {};
    const api: NativeCaptureApi = { startCapture: vi.fn(async (_ms, onFrame) => { hooks.onFrame = onFrame; }), setCaptureInterval: vi.fn(), stopCapture: vi.fn() };
    window.droidNative = api;
    localStorage.setItem('droid-assist.settings', JSON.stringify({ stages: { screenWatcher: false, supervisor: false }, ...settings }));
    vi.useFakeTimers({ toFake: ['Date'] });
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    await act(() => result.current.shareScreen());
    act(() => {
      result.current.setGoal('add the numbers');
      result.current.setSteps([measure]);
      result.current.setSettings({ ...result.current.settings, autoAct: true });
    });
    /** Delivers a frame 2 s after the last one (past Auto Act's pacing) and lets the step settle. */
    const tick = async () => {
      vi.setSystemTime(Date.now() + 2000);
      await act(async () => {
        hooks.onFrame!(frame());
        await new Promise((r) => setTimeout(r, 50));
      });
    };
    return { result, tick };
  }

  it('verifies the goal when no step is pending, plans the rest and keeps running until verified complete', async () => {
    const m = model([{ complete: false, progress: true, reason: 'one sum left' }, { complete: true, progress: true, reason: 'both sums shown' }]);
    const { result, tick } = await autoActing();
    for (let i = 0; i < 6 && !result.current.log.some((l) => /Auto Act stopped after/.test(l.message)); i++) await tick();
    expect(m.verifies()).toHaveLength(2);
    expect(m.plans()).toBe(1);
    const auto = result.current.log.filter((l) => l.source === 'Auto-continue').map((l) => l.message);
    expect(auto.some((x) => /Iteration 1 plan: 1 step\(s\) — measure "Measure 10"/.test(x))).toBe(true);
    expect(auto[0]).toMatch(/Auto Act stopped after 1 continuation\(s\): Goal verified complete — both sums shown/);
    expect(result.current.steps[0].name).toBe('Measure 10');
    expect(result.current.steps[0].status).not.toBe('pending');
  });

  it('stops at the max-iterations cap', async () => {
    const m = model([{ complete: false, progress: true, reason: 'more to do' }]);
    const { result, tick } = await autoActing({ maxIterations: 1 });
    for (let i = 0; i < 6 && !result.current.log.some((l) => /Auto Act stopped after/.test(l.message)); i++) await tick();
    expect(m.plans()).toBe(1);
    expect(result.current.log.find((l) => /Auto Act stopped after/.test(l.message))?.message).toMatch(/Max iterations \(1\) reached/);
  });

  it('with the auto-continue stage unchecked, Auto Act stops when its steps run out', async () => {
    const m = model([{ complete: false, progress: true, reason: 'x' }]);
    const { tick } = await autoActing({ stages: { screenWatcher: false, supervisor: false, autoContinue: false } });
    for (let i = 0; i < 3; i++) await tick();
    expect(m.verifies()).toHaveLength(0);
  });
});
