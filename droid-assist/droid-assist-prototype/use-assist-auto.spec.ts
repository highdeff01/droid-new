import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssist } from './use-assist.js';
import type { WorkflowStep } from './types.js';
import type { NativeCaptureApi, NativeFrame } from './electron/capture-api.js';

// jsdom has no canvas or image decoding: boxed and zoomed views are the frame itself here.
vi.mock('./grounding.js', async (orig) => ({ ...(await orig<typeof import('./grounding.js')>()), boxedFrames: vi.fn(async (f: unknown) => ({ full: f, crop: f })), zoomFrame: vi.fn(async (f: unknown) => f) }));

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

const frame = (): NativeFrame => ({ time: Date.now(), url: 'data:image/jpeg;base64,AA', pixels: new Uint8Array(320 * 180 * 4), srcW: 1920, srcH: 1080 });

/** A native screen capture whose frames the test pushes through `hooks.onFrame`. */
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
  return { hooks };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.droidNative;
  localStorage.clear();
});

// The demo PLAY button sits at (0.5, 0.62) at tick 0; nothing interactive is at (0.42, 0.97).
const play: WorkflowStep = { id: 'p', name: 'Press Play', action: 'click', target: 'Play button', x: 0.5, y: 0.62, status: 'pending' };
const miss: WorkflowStep = { id: 'm', name: 'Press Files', action: 'click', target: 'Files icon', x: 0.42, y: 0.97, status: 'pending' };

async function armedReplay(steps: WorkflowStep[], setup: (r: ReturnType<typeof useAssist>) => void = () => {}) {
  const hook = renderHook(() => useAssist());
  await act(async () => {});
  act(() => setup(hook.result.current));
  act(() => hook.result.current.setSteps(steps));
  act(() => hook.result.current.toggleArmed());
  await act(() => hook.result.current.replay());
  return hook.result;
}

describe('useAssist automatic population from a verified run', () => {
  it('learns coordinates, saves the access path, records section memory and saves the flow', async () => {
    localStorage.setItem('droid-assist.sections', JSON.stringify([{ id: 'sec', name: 'Player', box: { x: 0.3, y: 0.5, w: 0.4, h: 0.3 }, source: 'drawn', events: [] }]));
    const result = await armedReplay([play]);
    expect(result.current.steps[0].status).toBe('done');
    expect(result.current.learned.map((l) => l.name)).toContain('Play button');
    expect(result.current.routeProfiles[0]).toMatchObject({ goal: 'Play button', uses: 1, successes: 1, hops: [{ name: 'Play button', via: 'start' }] });
    expect(result.current.sections[0].events.some((e) => /Press Play/.test(e.text))).toBe(true);
    expect(result.current.cards).toHaveLength(1);
  });

  it('a dry run learns nothing and saves no path or flow', async () => {
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => result.current.setSteps([play]));
    await act(() => result.current.replay());
    expect(result.current.learned).toEqual([]);
    expect(result.current.routeProfiles).toEqual([]);
    expect(result.current.cards).toEqual([]);
  });

  it('respects loop control: coordinate learner off saves no path, workflow creation off saves no flow', async () => {
    const result = await armedReplay([play], (r) => {
      r.toggleStage('coords', false);
      r.toggleStage('workflowCreation', false);
    });
    expect(result.current.steps[0].status).toBe('done');
    expect(result.current.learned).toEqual([]);
    expect(result.current.routeProfiles).toEqual([]);
    expect(result.current.cards).toEqual([]);
  });
});

describe('useAssist automatic side tests', () => {
  it('side-tests an element the run failed on, in the background, once per cooldown', async () => {
    const result = await armedReplay([miss]);
    expect(result.current.sideResults).toHaveLength(1);
    expect(result.current.sideResults[0].name).toMatch(/Auto side test "Files icon"/);
    await act(() => result.current.replay());
    expect(result.current.sideResults).toHaveLength(1);
  });

  it('runs none with the side-tests stage or the side tester agent off', async () => {
    const off = await armedReplay([miss], (r) => r.toggleStage('sideTests', false));
    expect(off.current.sideResults).toEqual([]);
    const agentOff = await armedReplay([miss], (r) => r.setAgents((list) => list.map((a) => (a.id === 'sidetest' ? { ...a, on: false } : a))));
    expect(agentOff.current.sideResults).toEqual([]);
  });
});

describe('useAssist corrected approach', () => {
  it('remembers a step that succeeds after failing on the same element as its fix method', async () => {
    const wrong = { ...play, id: 'w', x: 0.42, y: 0.97 };
    // Side tests off: their hover at the failed point must not become the remembered position.
    const result = await armedReplay([wrong], (r) => r.toggleStage('sideTests', false));
    expect(result.current.steps[0].status).toBe('failed');
    expect(result.current.fixMethods).toEqual([]);
    act(() => result.current.setSteps([play]));
    await act(() => result.current.replay());
    expect(result.current.steps[0].status).toBe('done');
    expect(result.current.fixMethods[0]).toMatchObject({ element: 'Play button', successes: 1 });
    expect(result.current.log.some((l) => l.source === 'Fix script' && /Corrected approach/.test(l.message))).toBe(true);
  });
});

describe('useAssist AI self-test', () => {
  /** One reply every model call accepts: a planned hover, a confirmed target and a completed goal. */
  const universal = JSON.stringify({ steps: [{ name: 'Hover Play', action: 'move', target: 'Play button', x: 240, y: 167 }], visible: true, complete: true, progress: true, reason: 'looks right' });

  it('runs plan → ground → execute → verify on the live frame and reports a pass', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: { role: 'assistant', content: universal } }), { status: 200 })));
    const { hooks } = installNative();
    // Real-screen steps go through the bridge pipeline; disarmed, it verifies on the native frame and sends nothing.
    localStorage.setItem('droid-assist.settings', JSON.stringify({ bridgeUrl: 'http://pc' }));
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    await act(() => result.current.shareScreen());
    act(() => hooks.onFrame!(frame()));
    act(() => result.current.setGoal('hover the play button'));
    await act(async () => { await result.current.invoke('selftest.run'); });
    const report = result.current.selfTestReport!;
    expect(report.stages.map((s) => [s.stage, s.ok, s.ok ? '' : s.detail])).toEqual([['plan', true, ''], ['ground', true, ''], ['execute', true, ''], ['verify', true, '']]);
    expect(report).toMatchObject({ goal: 'hover the play button', pass: true, dryRun: true });
    expect(result.current.log.some((l) => l.source === 'Self-test' && /PASSED/.test(l.message))).toBe(true);
  });

  it('reports a failed plan stage when the AI is unreachable, without any step to replay', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    expect(result.current.steps).toEqual([]);
    await act(async () => { await result.current.invoke('selftest.run'); });
    expect(result.current.selfTestReport).toMatchObject({ pass: false, stages: [{ stage: 'plan', ok: false }] });
  });

  it('refuses while the self-test stage is unchecked', async () => {
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => result.current.toggleStage('selfTest', false));
    await act(async () => { await result.current.runSelfTestNow(); });
    expect(result.current.selfTestReport).toMatchObject({ pass: false, stages: [{ stage: 'plan', ok: false, detail: expect.stringMatching(/Self-test stage is unchecked/) }] });
  });
});
