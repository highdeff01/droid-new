import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssist } from './use-assist.js';
import type { NativeCaptureApi, NativeFrame } from './electron/capture-api.js';

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

const frame = (): NativeFrame => ({ time: Date.now(), url: 'data:image/jpeg;base64,AA', pixels: new Uint8Array(320 * 180 * 4), srcW: 1920, srcH: 1080 });

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
  };
  window.droidNative = api;
  return hooks;
}

const WOKEN = 'woken up while waiting';
const PROPOSE = 'state WHAT';

/** A fake model: OK ping, a one-step plan, a not-ready proposal estimating 8 s, and `decision` on waking. */
function stub(decision: string) {
  const replies: Record<string, string> = {
    ping: 'OK',
    plan: '{"steps":[{"name":"Click Save","action":"click","target":"save button","x":0.4,"y":0.6}]}',
    propose: '{"ready":false,"why":"the upload is still running","waitMs":8000}',
    decision,
    other: 'fine',
  };
  const pick = (body: string) => (body.includes('Reply with OK') ? 'ping' : body.includes(WOKEN) ? 'decision' : body.includes(PROPOSE) ? 'propose' : body.includes('Plan the concrete steps') ? 'plan' : 'other');
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify({ message: { role: 'assistant', content: replies[pick(init.body as string)] } }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const bodies = (fetchMock: ReturnType<typeof vi.fn>, marker: string) => fetchMock.mock.calls.map((c) => (c[1] as RequestInit).body as string).filter((b) => b.includes(marker));

/** Auto Act on a static screen: the step's proposal is not ready, so the AI waits. */
async function waitingRun() {
  localStorage.setItem('droid-assist.settings', JSON.stringify({ wakeMs: 5000 }));
  const hooks = installNative();
  const { result } = renderHook(() => useAssist());
  await act(() => vi.advanceTimersByTimeAsync(10));
  act(() => result.current.toggleStage('screenWatcher', false));
  act(() => result.current.toggleStage('supervisor', false));
  await act(() => result.current.shareScreen());
  act(() => hooks.onFrame!(frame()));
  act(() => result.current.setGoal('save the document'));
  await act(() => result.current.autoPlan());
  act(() => result.current.setSettings({ ...result.current.settings, autoAct: true }));
  await act(async () => {
    hooks.onFrame!(frame());
    await vi.advanceTimersByTimeAsync(50);
  });
  return { result, hooks };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.droidNative;
  localStorage.clear();
});

describe('useAssist wake and continue', () => {
  it('arms the wake with the AI estimate when it exceeds the user timer, and Auto Act does not act while waiting', async () => {
    vi.useFakeTimers();
    const fetchMock = stub('{"decision":"stop","reason":"done waiting"}');
    const { result, hooks } = await waitingRun();
    expect(result.current.wake.wait).toMatchObject({ step: 'Click Save', waitingOn: 'the upload is still running', delay: 8000, goal: 'save the document' });
    expect(result.current.watcher.notes.some((n) => n.kind === 'wake' && n.source === 'Wake' && n.op === 'save the document')).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
      hooks.onFrame!(frame());
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(bodies(fetchMock, PROPOSE)).toHaveLength(1);
    expect(bodies(fetchMock, WOKEN)).toHaveLength(0);
  });

  it('on the timer wakes the AI with before and fresh screenshots, executes nothing, and dispatches its stop decision', async () => {
    vi.useFakeTimers();
    const fetchMock = stub('{"decision":"stop","reason":"the upload failed"}');
    const { result } = await waitingRun();
    await act(() => vi.advanceTimersByTimeAsync(8100));
    const woke = bodies(fetchMock, WOKEN).map((b) => JSON.parse(b));
    expect(woke).toHaveLength(1);
    const user = woke[0].messages.at(-1);
    expect(user.images.length).toBeGreaterThanOrEqual(2);
    expect(user.content).toMatch(/the upload is still running/);
    expect(result.current.wake.wait).toBeNull();
    expect(result.current.settings.autoAct).toBe(false);
    expect(result.current.steps[0].status).toBe('pending');
    expect(result.current.history).toHaveLength(0);
    expect(result.current.watcher.notes.some((n) => n.kind === 'decision' && /stop/i.test(n.text))).toBe(true);
  });

  it('a wait decision re-arms the wake for the AI estimate', async () => {
    vi.useFakeTimers();
    stub('{"decision":"wait","reason":"still uploading","waitMs":20000}');
    const { result } = await waitingRun();
    await act(() => vi.advanceTimersByTimeAsync(8100));
    expect(result.current.wake.wait).toMatchObject({ step: 'Click Save', waitingOn: 'still uploading', delay: 20000 });
  });

  it('an abort during the wait cancels it without waking, and the error line is kept as an error note', async () => {
    vi.useFakeTimers();
    const fetchMock = stub('{"decision":"apply","reason":"ready"}');
    const { result } = await waitingRun();
    act(() => result.current.triggerAbort('test'));
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(result.current.wake.wait).toBeNull();
    expect(bodies(fetchMock, WOKEN)).toHaveLength(0);
    expect(result.current.log.some((l) => l.source === 'Wake' && /Wait cancelled \(abort\)/.test(l.message))).toBe(true);
    expect(result.current.watcher.notes.some((n) => n.kind === 'error' && n.source === 'Safety' && /ABORTED/.test(n.text))).toBe(true);
  });

  it('a goal change during the wait cancels it', async () => {
    vi.useFakeTimers();
    const fetchMock = stub('{"decision":"apply","reason":"ready"}');
    const { result } = await waitingRun();
    act(() => result.current.setGoal('something else'));
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(result.current.wake.wait).toBeNull();
    expect(bodies(fetchMock, WOKEN)).toHaveLength(0);
  });

  it('Stop during the wait cancels it without waking', async () => {
    vi.useFakeTimers();
    const fetchMock = stub('{"decision":"apply","reason":"ready"}');
    const { result } = await waitingRun();
    act(() => result.current.stop());
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(result.current.wake.wait).toBeNull();
    expect(bodies(fetchMock, WOKEN)).toHaveLength(0);
  });

  it('turning Auto Act off during the wait cancels it, so a wait decision never re-arms', async () => {
    vi.useFakeTimers();
    const fetchMock = stub('{"decision":"wait","reason":"still uploading","waitMs":6000}');
    const { result } = await waitingRun();
    act(() => result.current.setSettings({ ...result.current.settings, autoAct: false }));
    await act(() => vi.advanceTimersByTimeAsync(40000));
    expect(result.current.wake.wait).toBeNull();
    expect(bodies(fetchMock, WOKEN)).toHaveLength(0);
  });
});
