import { act, renderHook } from '@testing-library/react';
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

const frame = (): NativeFrame => ({ time: Date.now(), url: 'data:image/jpeg;base64,AA', pixels: new Uint8Array(320 * 180 * 4), srcW: 1920, srcH: 1080 });

function installNative() {
  const hooks: { onFrame?: (f: NativeFrame) => void; onError?: (m: string) => void } = {};
  const api: NativeCaptureApi = {
    startCapture: vi.fn(async (_ms, onFrame, onError) => {
      hooks.onFrame = onFrame;
      hooks.onError = onError;
    }),
    setCaptureInterval: vi.fn(),
    stopCapture: vi.fn(),
  };
  window.droidNative = api;
  return { api, hooks };
}

afterEach(() => {
  delete window.droidNative;
  localStorage.clear();
});

describe('useAssist flow and pattern memory', () => {
  const flow = { id: 'f1', name: 'Close ad and play video', description: '', savedAt: 1, steps: [{ id: 'a', name: 'Close ad', action: 'click', x: 0.8, y: 0.2, correctedX: 0.83, correctedY: 0.22, status: 'pending' }] };
  const lessons = [
    { id: 'p1', kind: 'avoid', pattern: 'clicking the taskbar', context: 'open notepad', time: 2 },
    { id: 'p2', kind: 'add', pattern: 'wait for the window', context: '', time: 1 },
  ];

  it('reuses a stored successful flow for a reworded goal and says so in the log', async () => {
    localStorage.setItem('droid-assist.cards', JSON.stringify([flow]));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    expect(result.current.cards.map((c) => c.id)).toContain('f1');
    // The engine pings the AI endpoint on mount; only the planning itself must make no model call.
    fetchSpy.mockClear();
    act(() => result.current.setGoal('dismiss the ads and play the videos'));
    await act(() => result.current.autoPlan());
    const planned = result.current.log.find((l) => l.source === 'Planner');
    expect(planned?.message).toMatch(/Reused saved workflow "Close ad and play video"/);
    expect(result.current.steps[0]).toMatchObject({ x: 0.83, y: 0.22, status: 'pending' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('loads persisted patterns and persists a deletion', () => {
    localStorage.setItem('droid-assist.patterns', JSON.stringify(lessons));
    const { result } = renderHook(() => useAssist());
    expect(result.current.patterns.map((p) => p.id)).toEqual(['p1', 'p2']);
    act(() => result.current.deletePattern('p1'));
    expect(result.current.patterns.map((p) => p.id)).toEqual(['p2']);
    expect(JSON.parse(localStorage.getItem('droid-assist.patterns')!).map((p: { id: string }) => p.id)).toEqual(['p2']);
  });
});

describe('useAssist Qwen thinking timeline', () => {
  const chatReply = (message: Record<string, unknown>) => vi.fn(async () => new Response(JSON.stringify({ message: { role: 'assistant', ...message } }), { status: 200 }));

  async function askWith(fetchImpl: ReturnType<typeof vi.fn>) {
    vi.stubGlobal('fetch', fetchImpl);
    const { hooks } = installNative();
    const { result } = renderHook(() => useAssist());
    await act(() => result.current.shareScreen());
    act(() => hooks.onFrame!(frame()));
    await act(() => result.current.askScreen('Where is search?'));
    return result;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('records the model thinking for an AI call', async () => {
    const result = await askWith(chatReply({ content: '{"answer":"Top bar","items":[]}', thinking: 'The search box is at the top.' }));
    expect(result.current.timeline[0]).toMatchObject({ step: 'Ask: Where is search?', kind: 'thought', text: 'Top bar', thinking: 'The search box is at the top.' });
    expect(typeof result.current.timeline[0].time).toBe('number');
  });

  it('records null thinking when the response carries none', async () => {
    const result = await askWith(chatReply({ content: '{"answer":"Top bar","items":[]}' }));
    expect(result.current.timeline[0]).toMatchObject({ kind: 'thought', text: 'Top bar', thinking: null });
  });

  it('records the plan thought, reflection and verdict of a /move step run through the pipeline', async () => {
    const replies: Record<string, Record<string, unknown>> = {
      plan: { content: '{"steps":[{"name":"Hover Files","action":"move","target":"files icon","x":0.1,"y":0.9}]}', thinking: 'Files sits bottom-left.' },
      reflect: { content: 'The cursor is on the files icon.', thinking: 'Looks right.' },
      verdict: { content: '{"success":true,"pattern_avoid":null,"pattern_add":"hover before clicking"}', thinking: 'It worked.' },
      propose: { content: '{"ready":true,"x":0.12,"y":0.9,"why":"Hovering Files is the goal itself."}', thinking: 'Files is still bottom-left.' },
    };
    const pick = (body: string) => (body.includes('final verdict') ? 'verdict' : body.includes('reviewing a step') ? 'reflect' : body.includes('state WHAT') ? 'propose' : 'plan');
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify({ message: { role: 'assistant', ...replies[pick(String(init.body))] } }), { status: 200 })));
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => result.current.setGoal('/move files icon'));
    await act(() => result.current.submitInput());
    expect(result.current.steps[0]).toMatchObject({ action: 'move', target: 'files icon' });
    const kinds = result.current.timeline.map((e) => [e.step, e.kind]);
    expect(kinds).toEqual([['Hover Files', 'verdict'], ['Hover Files', 'reflection'], ['Hover Files', 'proposal'], ['/move files icon', 'thought']]);
    expect(result.current.timeline[0]).toMatchObject({ thinking: 'It worked.' });
    expect(result.current.timeline[2]).toMatchObject({ thinking: 'Files is still bottom-left.' });
    expect(result.current.timeline[2].text).toMatch(/WHAT: move "files icon" at \(12%, 90%\) · WHY: Hovering Files is the goal itself\./);
    expect(result.current.timeline[3]).toMatchObject({ thinking: 'Files sits bottom-left.' });
    const moveLog = result.current.log.filter((l) => l.source === '/move').reverse().map((l) => l.message);
    const proposed = moveLog.findIndex((m) => /^Proposal for "Hover Files": WHAT/.test(m));
    const executed = moveLog.findIndex((m) => m.startsWith('Hover Files:'));
    expect(proposed).toBeGreaterThanOrEqual(0);
    expect(proposed).toBeLessThan(executed);
    expect(result.current.log.some((l) => l.source === '/move' && /Verdict on "Hover Files"/.test(l.message))).toBe(true);
  });

  it('records the endpoint failure instead of reasoning', async () => {
    const result = await askWith(vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(result.current.timeline[0]).toMatchObject({ kind: 'thought', text: '', thinking: null });
    expect(result.current.timeline[0].error).toMatch(/unreachable.*Failed to fetch/);
  });
});

describe('useAssist screen-change responder and proposals', () => {
  const black = (): NativeFrame => frame();
  /** A frame with a white 3×3-cell block (a material change at the default threshold). */
  const changed = (): NativeFrame => {
    const f = frame();
    for (let y = 40; y < 100; y++) for (let x = 80; x < 140; x++) f.pixels.fill(255, (y * 320 + x) * 4, (y * 320 + x) * 4 + 4);
    return f;
  };

  function stub(propose: string) {
    const replies: Record<string, string> = {
      ping: 'OK',
      change: '{"kind":"navigation","summary":"the Settings page","stale":true,"effect":"the Files icon moved"}',
      propose,
      plan: '{"steps":[{"name":"Hover Files","action":"move","target":"files icon","x":0.1,"y":0.9}]}',
      other: 'fine',
    };
    const pick = (body: string) => (body.includes('Reply with OK') ? 'ping' : body.includes('state WHAT') ? 'propose' : body.includes('screen-change responder. The first image') ? 'change' : body.includes('Plan the concrete steps') ? 'plan' : 'other');
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify({ message: { role: 'assistant', content: replies[pick(String(init.body))] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  async function changeMidPlan() {
    const { hooks } = installNative();
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    await act(() => result.current.shareScreen());
    act(() => hooks.onFrame!(black()));
    act(() => result.current.setGoal('hover the files icon'));
    await act(() => result.current.autoPlan());
    act(() => result.current.setSettings({ ...result.current.settings, autoAct: true }));
    await act(async () => {
      hooks.onFrame!(changed());
      await new Promise((r) => setTimeout(r, 50));
    });
    return result;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('responds to a second change that arrives while the first is being assessed', async () => {
    const fetchMock = stub('{"ready":false,"why":"waiting"}');
    const { hooks } = installNative();
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    await act(() => result.current.shareScreen());
    act(() => hooks.onFrame!(black()));
    const second = (): NativeFrame => {
      const f = changed();
      for (let y = 120; y < 180; y++) for (let x = 200; x < 300; x++) f.pixels.fill(255, (y * 320 + x) * 4, (y * 320 + x) * 4 + 4);
      return f;
    };
    await act(async () => {
      hooks.onFrame!(changed());
      hooks.onFrame!(second());
      await new Promise((r) => setTimeout(r, 30));
      hooks.onFrame!(second());
      await new Promise((r) => setTimeout(r, 30));
      hooks.onFrame!(second());
      await new Promise((r) => setTimeout(r, 30));
    });
    const changeCalls = fetchMock.mock.calls.filter((c) => String(c[1].body).includes('screen-change responder. The first image'));
    expect(changeCalls).toHaveLength(2);
  });

  it('assesses a mid-plan change and re-proposes the stale step (what/why referencing it) before it runs', async () => {
    const fetchMock = stub('{"ready":true,"x":0.2,"y":0.8,"why":"hovering Files is the goal"}');
    const result = await changeMidPlan();
    const change = result.current.timeline.find((e) => e.kind === 'change');
    expect(change?.text).toBe('[navigation] the Settings page — PLAN STALE: the Files icon moved');
    const changeReq = fetchMock.mock.calls.map((c) => JSON.parse(String(c[1].body))).find((b) => b.messages[0].content.includes('screen-change responder. The first image'));
    expect(changeReq.messages.at(-1).images).toHaveLength(2);
    const log = [...result.current.log].reverse();
    const assessed = log.findIndex((l) => l.source === 'Screen-change responder' && /PLAN STALE/.test(l.message));
    const proposed = log.findIndex((l) => l.source === 'Auto-Actor' && /^Re-proposal for "Hover Files": WHAT: move "files icon" at \(20%, 80%\) · WHY: The screen now shows the Settings page, so I will/.test(l.message));
    const ran = log.findIndex((l) => l.source.startsWith('Auto-Actor') && l.message.startsWith('Hover Files:'));
    expect(assessed).toBeGreaterThanOrEqual(0);
    expect(proposed).toBeGreaterThan(assessed);
    expect(ran).toBeGreaterThan(proposed);
    expect(result.current.timeline.find((e) => e.kind === 'proposal')?.text).toMatch(/WHY: The screen now shows the Settings page/);
  });

  it('fails the step honestly when its one re-proposal still cannot justify it', async () => {
    stub('{"ready":false,"why":"the Files icon is not on this page"}');
    const result = await changeMidPlan();
    expect(result.current.steps[0].status).toBe('failed');
    expect(result.current.log.some((l) => l.source === 'Auto-Actor' && /could not be justified after re-proposal: The screen now shows the Settings page.*the Files icon is not on this page/.test(l.message))).toBe(true);
    expect(result.current.log.some((l) => l.message.startsWith('Hover Files:'))).toBe(false);
  });
});

describe('useAssist screen capture', () => {
  it('starts native capture at the configured rate and analyses every pushed frame', async () => {
    const { api, hooks } = installNative();
    const { result } = renderHook(() => useAssist());
    await act(() => result.current.shareScreen());
    expect(api.startCapture).toHaveBeenCalledWith(result.current.settings.captureMs, expect.any(Function), expect.any(Function));
    expect(result.current.source).toBe('screen');
    act(() => {
      hooks.onFrame!(frame());
      hooks.onFrame!(frame());
    });
    expect(result.current.frames).toHaveLength(2);
    expect(result.current.frames[0].source).toBe('screen');
    expect(result.current.frames[0].srcW).toBe(1920);
  });

  it('applies a capture-rate change to the running capture', async () => {
    const { api } = installNative();
    const { result } = renderHook(() => useAssist());
    await act(() => result.current.shareScreen());
    act(() => result.current.setSettings({ ...result.current.settings, captureMs: 250 }));
    expect(api.setCaptureInterval).toHaveBeenLastCalledWith(250);
  });

  it('raises a loud error and never falls back to the demo when capture is lost', async () => {
    const { hooks } = installNative();
    const { result } = renderHook(() => useAssist());
    await act(() => result.current.shareScreen());
    act(() => hooks.onError!('Display disconnected'));
    expect(result.current.source).toBe('screen');
    expect(result.current.captureLost).toBe('Display disconnected');
    expect(result.current.log[0].tone).toBe('error');
    expect(result.current.log[0].message).toContain('Display disconnected');
  });

  it('logs an error when capture cannot start and stays on the current source', async () => {
    const { api } = installNative();
    vi.mocked(api.startCapture).mockRejectedValueOnce(new Error('No screen source available to capture'));
    const { result } = renderHook(() => useAssist());
    await act(() => result.current.shareScreen());
    expect(result.current.source).toBe('demo');
    expect(result.current.log[0].tone).toBe('error');
  });

  it('switches to the demo only when the user asks', async () => {
    const { hooks } = installNative();
    const { result } = renderHook(() => useAssist());
    await act(() => result.current.shareScreen());
    act(() => hooks.onError!('gone'));
    act(() => result.current.useDemo());
    expect(result.current.source).toBe('demo');
    expect(result.current.captureLost).toBeNull();
  });
});
