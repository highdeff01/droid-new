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

describe('useAssist elements and Test click', () => {
  const el = { id: 'el1', name: 'Files icon', x: 0.42, y: 0.97, source: 'familiar' as const };

  it('lists persisted familiar elements and persists forgetting one', () => {
    localStorage.setItem('droid-assist.familiar', JSON.stringify([{ id: 'el1', name: 'Files icon', x: 0.42, y: 0.97, lastSeen: 1 }]));
    const { result } = renderHook(() => useAssist());
    expect(result.current.elements).toMatchObject([{ name: 'Files icon', x: 0.42, y: 0.97, source: 'familiar' }]);
    act(() => result.current.forgetFamiliar('el1'));
    expect(result.current.elements).toEqual([]);
    expect(JSON.parse(localStorage.getItem('droid-assist.familiar')!)).toEqual([]);
  });

  it('disarmed: highlights the target only — no input, no action recorded', async () => {
    const { result } = renderHook(() => useAssist());
    await act(() => result.current.testClick(el));
    expect(result.current.highlight).toMatchObject({ x: 0.42, y: 0.97, label: 'Files icon' });
    expect(result.current.history).toHaveLength(0);
    expect(result.current.log.find((l) => l.source === 'Test click')?.message).toMatch(/H6 .*dry run/);
  });

  it('armed: clicks through the gated pipeline; aborted refuses', async () => {
    const { result } = renderHook(() => useAssist());
    act(() => result.current.toggleArmed());
    await act(() => result.current.testClick(el));
    // On the demo desktop the click is really applied at the point; nothing interactive is there.
    expect(result.current.log.find((l) => l.source === 'Test click')?.message).toMatch(/Files icon.*hit nothing interactive/);
    expect(result.current.cursor).toEqual({ x: 0.42, y: 0.97 });
    act(() => result.current.triggerAbort('test'));
    await act(() => result.current.testClick(el));
    expect(result.current.log.find((l) => l.source === 'Test click')?.message).toMatch(/Aborted/);
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

describe('useAssist habits', () => {
  const habit = (id: string, target: string) => ({ id, target, context: 'Notepad', attempts: 4, successes: 3, lastUsed: Date.now(), lessons: [], pinned: false });
  const seeded = [habit('h1', 'Save button'), habit('h2', 'Close icon')];
  const lessons = [
    { id: 'p1', kind: 'avoid', pattern: 'clicking the taskbar', context: 'open notepad', time: 2 },
    { id: 'p2', kind: 'add', pattern: 'wait for the window', context: '', time: 1 },
  ];

  it('loads persisted habits', () => {
    localStorage.setItem('droid-assist.habits', JSON.stringify(seeded));
    const { result } = renderHook(() => useAssist());
    expect(result.current.habits.map((h) => h.id)).toEqual(['h1', 'h2']);
  });

  it('pins a habit and persists the pin', () => {
    localStorage.setItem('droid-assist.habits', JSON.stringify(seeded));
    const { result } = renderHook(() => useAssist());
    act(() => result.current.pinHabit('h1'));
    expect(result.current.habits.find((h) => h.id === 'h1')).toMatchObject({ pinned: true });
    const stored = JSON.parse(localStorage.getItem('droid-assist.habits')!);
    expect(stored.find((h: { id: string }) => h.id === 'h1')).toMatchObject({ pinned: true });
  });

  it('deletes a habit from state and storage', () => {
    localStorage.setItem('droid-assist.habits', JSON.stringify(seeded));
    const { result } = renderHook(() => useAssist());
    act(() => result.current.deleteHabit('h1'));
    expect(result.current.habits.map((h) => h.id)).toEqual(['h2']);
    const stored = JSON.parse(localStorage.getItem('droid-assist.habits')!);
    expect(stored.map((h: { id: string }) => h.id)).toEqual(['h2']);
  });

  it('loads habits and patterns side by side', () => {
    localStorage.setItem('droid-assist.habits', JSON.stringify(seeded));
    localStorage.setItem('droid-assist.patterns', JSON.stringify(lessons));
    const { result } = renderHook(() => useAssist());
    expect(result.current.habits.map((h) => h.id)).toEqual(['h1', 'h2']);
    expect(result.current.patterns.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});
