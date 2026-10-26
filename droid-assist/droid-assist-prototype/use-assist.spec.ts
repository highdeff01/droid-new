import { act, renderHook } from '@testing-library/react';
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
    };
    const pick = (body: string) => (body.includes('final verdict') ? 'verdict' : body.includes('reviewing a step') ? 'reflect' : 'plan');
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify({ message: { role: 'assistant', ...replies[pick(String(init.body))] } }), { status: 200 })));
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => result.current.setGoal('/move files icon'));
    await act(() => result.current.submitInput());
    expect(result.current.steps[0]).toMatchObject({ action: 'move', target: 'files icon' });
    const kinds = result.current.timeline.map((e) => [e.step, e.kind]);
    expect(kinds).toEqual([['Hover Files', 'verdict'], ['Hover Files', 'reflection'], ['/move files icon', 'thought']]);
    expect(result.current.timeline[0]).toMatchObject({ thinking: 'It worked.' });
    expect(result.current.timeline[2]).toMatchObject({ thinking: 'Files sits bottom-left.' });
    expect(result.current.log.some((l) => l.source === '/move' && /Verdict on "Hover Files"/.test(l.message))).toBe(true);
  });

  it('records the endpoint failure instead of reasoning', async () => {
    const result = await askWith(vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(result.current.timeline[0]).toMatchObject({ kind: 'thought', text: '', thinking: null });
    expect(result.current.timeline[0].error).toMatch(/unreachable.*Failed to fetch/);
  });
});

describe('useAssist agent forwarding and subagent link tests', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Stub model: plans one move onto the link named in the goal, reflects, and passes every link except "Calc". */
  function stubModel() {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = String(init.body);
      bodies.push(body);
      // The body carries the session history, so the newest mention names the current link.
      const step = body.includes('final verdict') || body.includes('reviewing a step');
      const mentions = [...body.matchAll(step ? /Move to (Files|Notes|Calc)/g : /\\"(Files|Notes|Calc)\\"/g)];
      const link = mentions.at(-1)?.[1] ?? 'Files';
      const message = body.includes('final verdict')
        ? { content: JSON.stringify({ success: link !== 'Calc', pattern_avoid: link === 'Calc' ? 'clicking Calc twice' : null, pattern_add: null }), thinking: `verdict ${link}` }
        : body.includes('reviewing a step')
          ? { content: `Reached ${link}.`, thinking: null }
          : { content: JSON.stringify({ steps: [{ name: `Move to ${link}`, action: 'move', target: link, x: 0.1, y: 0.5 }] }), thinking: `plan ${link}` };
      return new Response(JSON.stringify({ message: { role: 'assistant', ...message } }), { status: 200 });
    }));
    return bodies;
  }

  it('runs one subagent per link through plan, execute, reflect and verdict, and reports pass/fail', async () => {
    const bodies = stubModel();
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => result.current.setGoal('/test links Files, Notes, Calc'));
    await act(() => result.current.submitInput());
    const report = result.current.subReport!;
    expect(report.finished).toBe(true);
    expect(report.results.map((r) => [r.label, r.status, r.dry])).toEqual([['Files', 'pass', true], ['Notes', 'pass', true], ['Calc', 'fail', true]]);
    expect(report.results[0].thinking).toEqual(['plan Files', 'verdict Files']);
    expect(report.results.reduce((s, r) => s + r.budget, 0)).toBeLessThanOrEqual(result.current.settings.actionBudget);
    expect(bodies.filter((b) => b.includes('final verdict'))).toHaveLength(3);
    expect(result.current.patterns.some((p) => p.kind === 'avoid' && p.pattern === 'clicking Calc twice')).toBe(true);
    expect(result.current.patterns.some((p) => p.kind === 'add' && /Files/.test(p.pattern))).toBe(true);
    // Passed links are forwarded on the bus: predefined by the coordinate learner.
    expect(result.current.knownElements.map((e) => e.name)).toEqual(['Notes', 'Files']);
    expect(result.current.bus.some((m) => m.from === 'supervisor' && m.to === 'habits' && m.status === 'handled')).toBe(true);
    expect(result.current.log.some((l) => l.source === 'Supervisor' && /2\/3 passed · 1 failed/.test(l.message))).toBe(true);
  });

  it('fails a subagent loudly and never passes it when the AI is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    await act(() => result.current.testRoutes({ kind: 'link', items: ['Files'], goal: 'test Files' }));
    expect(result.current.subReport!.results[0]).toMatchObject({ status: 'fail', thinking: [] });
    expect(result.current.subReport!.results[0].message).toMatch(/unreachable/);
  });

  it('aborts the remaining subagents after the emergency stop', async () => {
    stubModel();
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => result.current.triggerAbort('test'));
    await act(() => result.current.testRoutes({ kind: 'route', items: ['Files', 'Notes'], goal: 'route' }));
    expect(result.current.subReport).toBeNull();
    expect(result.current.log[0].message).toMatch(/ABORTED is active/);
  });

  it('forwards an element from any agent into every other inbox', () => {
    const { result } = renderHook(() => useAssist());
    act(() => result.current.forwardElement('drift', { name: 'Search box', x: 0.5, y: 0.1 }));
    expect(new Set(result.current.bus.map((m) => m.to)).size).toBe(7);
    expect(result.current.bus.every((m) => m.status === 'handled')).toBe(true);
    expect(result.current.knownElements[0].name).toBe('Search box');
    expect(result.current.patterns[0]).toMatchObject({ kind: 'add' });
    expect(result.current.annotations.some((a) => a.label === 'Watching: Search box')).toBe(true);
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
