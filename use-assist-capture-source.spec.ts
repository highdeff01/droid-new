import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaptureHandlers, ScreenCapture } from './capture.js';
import type { Frame, WorkflowStep } from './types.js';
import type { NativeCaptureApi, NativeFrame } from './electron/capture-api.js';
import { SAMPLE_H, SAMPLE_W } from './drift.js';

vi.mock('./grounding.js', async (orig) => ({ ...(await orig<typeof import('./grounding.js')>()), boxedFrames: vi.fn(async (f: unknown) => ({ full: f, crop: f })) }));

/** The browser capture under test: a getDisplayMedia stand-in whose frames the test pushes. */
const browser: { handlers?: CaptureHandlers; use: boolean } = { use: false };
vi.mock('./capture.js', async (orig) => {
  const real = await orig<typeof import('./capture.js')>();
  const displayMedia = (): ScreenCapture => ({
    kind: 'display-media',
    start: async (_ms, h) => {
      browser.handlers = h;
    },
    setInterval: () => {},
    selectDisplay: () => {},
    stop: () => {},
  });
  return { ...real, createScreenCapture: () => (browser.use ? displayMedia() : real.createScreenCapture()) };
});

const { useAssist } = await import('./use-assist.js');

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

/** A dark screen with one bright square (the step's target) centred at (cx, cy) in sample pixels. */
function pixels(cx: number, cy: number): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(new ArrayBuffer(SAMPLE_W * SAMPLE_H * 4));
  for (let y = 0; y < SAMPLE_H; y++) {
    for (let x = 0; x < SAMPLE_W; x++) {
      const v = Math.abs(x - cx) < 6 && Math.abs(y - cy) < 6 ? 240 : x - cx >= 6 && x - cx < 10 && Math.abs(y - cy) < 3 ? 140 : 20;
      data.set([v, v, v, 255], (y * SAMPLE_W + x) * 4);
    }
  }
  return data;
}

const image = (cx: number, cy: number) => new ImageData(pixels(cx, cy), SAMPLE_W, SAMPLE_H);
const refFrame = (cx: number, cy: number): Frame => ({ id: 0, time: 0, url: 'data:image/jpeg;base64,AA', data: image(cx, cy), srcW: 1920, srcH: 1080, source: 'screen' });
const nativeFrame = (cx: number, cy: number): NativeFrame => ({ time: Date.now(), url: 'data:image/jpeg;base64,AA', pixels: new Uint8Array(pixels(cx, cy).buffer), srcW: 1920, srcH: 1080 });
/** A recorded click on the square at (100, 60). */
const step = (): WorkflowStep => ({ id: 's1', name: 'Press play', action: 'click', x: 100 / SAMPLE_W, y: 60 / SAMPLE_H, refFrame: refFrame(100, 60), status: 'pending' });

function installNative() {
  const hooks: { onFrame?: (f: NativeFrame) => void } = {};
  const api: NativeCaptureApi = {
    startCapture: vi.fn(async (_ms, onFrame) => {
      hooks.onFrame = onFrame;
    }),
    setCaptureInterval: vi.fn(),
    stopCapture: vi.fn(),
    listDisplays: vi.fn(async () => []),
    selectDisplay: vi.fn(),
    grabDisplay: vi.fn(),
  };
  window.droidNative = api;
  return hooks;
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

/** fetch that fails every AI call and answers the desktop bridge (health and completed replays); records bridge calls. */
function bridgeFetch() {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (!u.startsWith('http://pc')) throw new TypeError('Failed to fetch');
    calls.push({ url: u, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    if (u.endsWith('/api/health')) return json({ ok: true });
    if (u.endsWith('/api/replay')) return json({ success: true, run: { id: 'run-1', status: 'running' } });
    if (u.includes('/api/replay/run-1')) return json({ success: true, run: { id: 'run-1', status: 'completed' } });
    if (u.endsWith('/api/replay/capture')) throw new TypeError('the bridge screenshot must not be used for a captured source');
    throw new TypeError('Failed to fetch');
  }));
  return calls;
}

afterEach(() => {
  cleanup();
  delete window.droidNative;
  browser.use = false;
  browser.handlers = undefined;
  localStorage.clear();
  vi.unstubAllGlobals();
});

/** The engine sharing the local screen (Electron native, or the browser share) with one frame of the target shifted by (dx, dy). */
async function sharing(kind: ScreenCapture['kind'], dx: number, dy: number) {
  const hooks = kind === 'native' ? installNative() : undefined;
  browser.use = kind === 'display-media';
  const { result } = renderHook(() => useAssist());
  await act(async () => {});
  await act(() => result.current.shareScreen());
  act(() => {
    if (hooks) hooks.onFrame!(nativeFrame(100 + dx, 60 + dy));
    else browser.handlers!.onImage({ time: Date.now(), url: 'data:image/jpeg;base64,AA', data: image(100 + dx, 60 + dy), srcW: 1920, srcH: 1080 });
  });
  act(() => result.current.setSteps([step()]));
  return result;
}

const logOf = (result: { current: ReturnType<typeof useAssist> }, source: string) => result.current.log.filter((l) => l.source === source).map((l) => l.message);

describe.each(['native', 'display-media'] as const)('replay and drift on the local %s capture', (kind) => {
  it('self-test verifies on the captured frame with drift correction and needs no desktop bridge', async () => {
    const calls = bridgeFetch();
    const result = await sharing(kind, 10, 6);
    await act(() => result.current.replay(true));
    const lines = logOf(result, 'Self-test');
    expect(lines.some((m) => /drift \d+px .*corrected by \(\+60, \+36\)px/.test(m))).toBe(true);
    expect(lines.some((m) => /Press play: verified on the live screen — dry run — not dispatched/.test(m))).toBe(true);
    expect(lines.some((m) => /no step was executed/.test(m))).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('the drift monitor and the HUD status follow the captured frames', async () => {
    bridgeFetch();
    const result = await sharing(kind, 0, 0);
    expect(result.current.captureSource).toMatchObject({ source: 'screen', armed: true, label: kind === 'native' ? 'Electron screen capture' : 'Browser screen share' });
    act(() => {
      if (kind === 'display-media') browser.handlers!.onImage({ time: Date.now(), url: 'data:image/jpeg;base64,AA', data: image(100, 60), srcW: 1920, srcH: 1080 });
    });
    const drift = await act(() => result.current.invoke('drift.check', {}, { kind: 'ai' }));
    expect(drift.ok).toBe(true);
    expect(drift.result).toMatch(/"Press play" on the .*: green/);
  });

  it('armed: the step is sent to the desktop bridge at the drift-corrected point of the captured frame', async () => {
    localStorage.setItem('droid-assist.settings', JSON.stringify({ bridgeUrl: 'http://pc' }));
    const calls = bridgeFetch();
    const result = await sharing(kind, 10, 6);
    act(() => result.current.toggleArmed());
    await act(() => result.current.replay());
    const sent = calls.filter((c) => c.url === 'http://pc/api/replay');
    expect(sent).toHaveLength(1);
    expect((sent[0].body as { steps: unknown[] }).steps[0]).toMatchObject({ action: 'click', x: 660, y: 396 });
    expect(calls.some((c) => c.url.endsWith('/api/replay/capture'))).toBe(false);
  });
});

describe('local screen without a desktop bridge', () => {
  it('armed real input is refused loudly, nothing simulated', async () => {
    bridgeFetch();
    const result = await sharing('native', 0, 0);
    act(() => result.current.toggleArmed());
    await act(() => result.current.replay());
    expect(logOf(result, 'Replay').some((m) => /bridge/i.test(m) && /no step was executed/.test(m))).toBe(true);
    expect(result.current.history).toHaveLength(0);
  });
});
