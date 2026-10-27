import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssist } from './use-assist.js';
import type { NativeCaptureApi, NativeFrame } from './electron/capture-api.js';

// jsdom has no canvas: the boxed full frame and zoomed crop are the frame itself here.
vi.mock('./grounding.js', async (orig) => ({ ...(await orig<typeof import('./grounding.js')>()), boxedFrames: vi.fn(async (f: unknown) => ({ full: f, crop: f })) }));

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

type Engine = { current: ReturnType<typeof useAssist> };
type Call = { url: string; body: unknown };

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const withBridge = () => localStorage.setItem('droid-assist.settings', JSON.stringify({ bridgeUrl: 'http://pc' }));
const frame = (): NativeFrame => ({ time: Date.now(), url: 'data:image/jpeg;base64,AA', pixels: new Uint8Array(320 * 180 * 4), srcW: 1920, srcH: 1080 });
const lines = (r: Engine, source: string) => r.current.log.filter((l) => l.source === source);
const replayPosts = (calls: Call[]) => calls.filter((c) => c.url === 'http://pc/api/replay');

/** Waits (inside act) until a mirrored input fired by a stage handler has logged its outcome line. */
async function settled(r: Engine, source: string, pattern: RegExp) {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(lines(r, source).some((l) => pattern.test(l.message))).toBe(true);
  }, { timeout: 4000 });
}

/** A PC bridge that is up: health ok, a desktop shot, and every replay run completed. Records every call. */
function bridgeUp(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    if (url.endsWith('/api/health')) return json({ ok: true });
    if (url.endsWith('/api/replay/capture')) return json({ success: true, frame: { image: 'data:image/png;base64,AA', width: 1000, height: 800 } });
    if (url.endsWith('/api/replay')) return json({ success: true, run: { id: 'run-9', status: 'running' } });
    if (url.includes('/api/replay/run-9')) return json({ success: true, run: { id: 'run-9', status: 'completed' } });
    throw new TypeError('Failed to fetch');
  }));
  return calls;
}

/** Native screen capture feeding one frame, so bridge steps verify on it instead of decoding a screenshot. */
async function shareNativeScreen(result: Engine) {
  const hooks: { onFrame?: (f: NativeFrame) => void } = {};
  const api: NativeCaptureApi = {
    startCapture: vi.fn(async (_ms, onFrame) => {
      hooks.onFrame = onFrame;
    }),
    setCaptureInterval: vi.fn(),
    stopCapture: vi.fn(),
    listDisplays: vi.fn(async () => []),
    selectDisplay: vi.fn(),
  };
  window.droidNative = api;
  await act(() => result.current.shareScreen());
  act(() => hooks.onFrame!(frame()));
}

/** Every model call answers with one play turn: a chest to open (focus) and a guard to watch (peripheral). */
const playReply = () => vi.fn(async () => json({
  message: {
    role: 'assistant',
    content: JSON.stringify({
      elements: [{ name: 'Chest', x: 0.3, y: 0.6, relevance: 0.9 }, { name: 'Guard', x: 0.8, y: 0.2, relevance: 0.2 }, { name: ' ', x: 0.1, y: 0.1, relevance: 1 }],
      action: { kind: 'click', x: 0.3, y: 0.6 },
      did: 'Opened the chest',
      learned: 'Chests hold keys',
      achieved: 'Found a key',
    }),
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.droidNative;
  localStorage.clear();
});

describe('useAssist mirror input', () => {
  it('is a passive preview until switched on; on and disarmed it is a labeled dry run', () => {
    const { result } = renderHook(() => useAssist());
    expect(result.current.mirrorOn).toBe(false);
    expect(result.current.mirror).toEqual({ interactive: false, real: false, label: 'Mirror off — passive preview' });
    act(() => result.current.toggleMirror());
    expect(result.current.mirror).toMatchObject({ interactive: true, real: false });
    expect(result.current.mirror.label).toMatch(/^Mirror DRY RUN — disarmed/);
  });

  it('passive: a click on the preview is not mirrored', async () => {
    const { result } = renderHook(() => useAssist());
    await act(async () => result.current.onStageClick(0.42, 0.97));
    expect(lines(result, 'Mirror')).toEqual([]);
  });

  it('disarmed: a click on the mirror is a labeled dry run and nothing reaches the bridge', async () => {
    withBridge();
    const calls = bridgeUp();
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    await shareNativeScreen(result);
    act(() => result.current.toggleMirror());
    act(() => result.current.onStageClick(0.42, 0.97));
    await settled(result, 'Mirror', /^DRY RUN · /);
    const line = lines(result, 'Mirror').find((l) => l.message.startsWith('DRY RUN · '))!;
    expect(line.message).toMatch(/^DRY RUN · Mirror click \(42\.0%, 97\.0%\)/);
    expect(line.message).toMatch(/dry run — not dispatched/);
    expect(replayPosts(calls)).toEqual([]);
  });

  it('armed with a connected bridge: a click on the mirror is dispatched to the PC through /api/replay', async () => {
    withBridge();
    const calls = bridgeUp();
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    await shareNativeScreen(result);
    act(() => result.current.toggleArmed());
    act(() => result.current.toggleMirror());
    expect(result.current.mirror).toEqual({ interactive: true, real: true, label: 'Mirror LIVE — input goes to the PC' });
    await act(async () => {
      await result.current.mirrorInput({ kind: 'click', x: 0.5, y: 0.5 });
    });
    const sent = replayPosts(calls);
    expect(sent).toHaveLength(1);
    expect((sent[0].body as { steps: Array<{ action: string }> }).steps[0].action).toBe('click');
    expect(lines(result, 'Mirror')[0].message).not.toMatch(/DRY RUN/);
  });

  it('routes drag, typed text and key presses through the mirror', async () => {
    const { result } = renderHook(() => useAssist());
    act(() => result.current.toggleMirror());
    act(() => result.current.onStageDrag({ x: 0.9, y: 0.2 }, { x: 0.4, y: 0.5 }));
    await settled(result, 'Mirror', /^DRY RUN · Mirror drag/);
    act(() => result.current.onStageType('hello'));
    await settled(result, 'Mirror', /^DRY RUN · Mirror type "hello"/);
    act(() => result.current.onStageKey({ key: 's', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }));
    await settled(result, 'Mirror', /^DRY RUN · Mirror press ctrl\+s/);
    expect(lines(result, 'Mirror').every((l) => l.message.includes('dry run — not dispatched'))).toBe(true);
  });

  it('ruler and element-map modes take precedence: drag, scroll and keys are not mirrored', async () => {
    const { result } = renderHook(() => useAssist());
    act(() => result.current.toggleMirror());
    act(() => result.current.toggleMapMode());
    act(() => result.current.onStageScroll(0.5, 0.5, 120));
    act(() => result.current.onStageKey({ key: 'a', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }));
    await act(async () => {});
    expect(lines(result, 'Mirror').filter((l) => l.message.startsWith('DRY RUN'))).toEqual([]);
  });

  it('armed but the bridge is not connected: the badge says dry run and nothing reaches the bridge', async () => {
    withBridge();
    const calls: Call[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push({ url: String(url), body: null });
      throw new TypeError('Failed to fetch');
    }));
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => result.current.toggleArmed());
    act(() => result.current.toggleMirror());
    expect(result.current.mirror.real).toBe(false);
    expect(result.current.mirror.label).toMatch(/^Mirror DRY RUN/);
    let out: Awaited<ReturnType<typeof result.current.mirrorInput>> | undefined;
    await act(async () => {
      out = await result.current.mirrorInput({ kind: 'click', x: 0.5, y: 0.5 });
    });
    expect(out!.executed).toBe(false);
    expect(replayPosts(calls)).toEqual([]);
    expect(lines(result, 'Mirror')[0].message).toMatch(/^DRY RUN · .*dry run — not dispatched/);
  });

  it('kill switch turns mirror input off and keeps it off until the abort is cleared', () => {
    const { result } = renderHook(() => useAssist());
    act(() => result.current.toggleMirror());
    act(() => result.current.triggerAbort('test'));
    expect(result.current.mirrorOn).toBe(false);
    act(() => result.current.toggleMirror());
    expect(result.current.mirrorOn).toBe(false);
    expect(lines(result, 'Mirror')[0]).toMatchObject({ tone: 'warn', message: expect.stringMatching(/Aborted/) });
    act(() => result.current.clearAbort());
    act(() => result.current.toggleMirror());
    expect(result.current.mirrorOn).toBe(true);
  });
});

describe('useAssist persona play', () => {
  it('creates, selects and persists a persona; a blank name is refused', () => {
    const { result } = renderHook(() => useAssist());
    act(() => result.current.addPersona('Rogue', 'sneaky thief'));
    expect(result.current.personas).toMatchObject([{ name: 'Rogue', character: 'sneaky thief', entries: [] }]);
    expect(result.current.personaId).toBe(result.current.personas[0].id);
    expect(JSON.parse(localStorage.getItem('droid-assist.personas')!)).toMatchObject([{ name: 'Rogue' }]);
    act(() => result.current.addPersona('  ', 'x'));
    expect(result.current.personas).toHaveLength(1);
    expect(lines(result, 'Persona')[0].tone).toBe('warn');
  });

  it('refuses a play turn without a persona', async () => {
    const { result } = renderHook(() => useAssist());
    const out = await act(() => result.current.playTurn());
    expect(out).toBeNull();
    expect(lines(result, 'AI play')[0]).toMatchObject({ tone: 'warn' });
  });

  it('a play turn logs elements with position and relevance, plans lanes, acts through the mirror and grows the portfolio', async () => {
    vi.stubGlobal('fetch', playReply());
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => result.current.addPersona('Rogue', 'sneaky thief'));
    await act(async () => {
      await result.current.playTurn();
    });
    expect(result.current.sightings.map((s) => [s.name, s.x, s.y, s.relevance])).toEqual(expect.arrayContaining([['Chest', 0.3, 0.6, 0.9], ['Guard', 0.8, 0.2, 0.2]]));
    expect(result.current.sightings).toHaveLength(2);
    expect(result.current.playView).toMatchObject({ turn: 1, focus: { name: 'Chest' } });
    expect(result.current.lanes.map((l) => [l.kind, l.element.name, l.recapture])).toEqual([['act', 'Chest', true], ['monitor', 'Guard', false]]);
    expect(lines(result, 'AI play · Rogue')[0].message).toMatch(/^DRY RUN · Mirror click/);
    const stored = JSON.parse(localStorage.getItem('droid-assist.personas')!)[0] as { entries: Array<{ kind: string; text: string }> };
    expect(stored.entries.map((e) => e.kind).sort()).toEqual(['achieved', 'did', 'learned']);
    expect(stored.entries).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'learned', text: 'Chests hold keys' }), expect.objectContaining({ kind: 'achieved', text: 'Found a key' })]));
  });

  it('stops AI play after the kill switch', async () => {
    vi.stubGlobal('fetch', playReply());
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => result.current.addPersona('Rogue', ''));
    act(() => result.current.triggerAbort('test'));
    await act(() => result.current.playTurns(3));
    expect(result.current.playView.turn).toBe(0);
    expect(lines(result, 'AI play · Rogue')).toEqual([]);
  });
});
