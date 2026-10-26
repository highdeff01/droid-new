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

describe('useAssist Screen watcher', () => {
  const observation = JSON.stringify({
    notes: [{ kind: 'element', text: 'Files sidebar item at the left' }, { kind: 'unusual', text: 'An ad covers the top right' }],
    proposals: [{ kind: 'familiar', text: 'Files sidebar item is stable — save as familiar element', target: 'Files sidebar item', cell: 'C1', cx: 0.5, cy: 0.5 }],
  });
  /** A fake model: watcher observations, step reflections/verdicts, and OK for the health ping. */
  const model = () => vi.fn(async (_url: string, init: RequestInit) => {
    const body = String(init.body);
    const content = body.includes('screen watcher') ? observation
      : body.includes('final verdict') ? '{"success":false,"pattern_avoid":null,"pattern_add":null}'
        : body.includes('reviewing a step') ? 'It did not run.' : 'OK';
    return new Response(JSON.stringify({ message: { role: 'assistant', content, thinking: 'watching' } }), { status: 200 });
  });
  const watcherCalls = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.filter(([, init]) => String((init as RequestInit).body).includes('screen watcher')).length;
  const enableWatcher = (result: { current: ReturnType<typeof useAssist> }) =>
    act(() => result.current.setAgents(result.current.agents.map((a) => (a.id === 'watcher' ? { ...a, on: true } : a))));

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is a fifth agent, off by default, beside the existing four', () => {
    const { result } = renderHook(() => useAssist());
    expect(result.current.agents.map((a) => a.id)).toEqual(['popup', 'drift', 'progress', 'goal', 'watcher']);
    expect(result.current.agents.find((a) => a.id === 'watcher')?.on).toBe(false);
    expect(result.current.settings.watchMs).toBe(5000);
  });

  it('observes the live capture at its interval: deduplicated notes, one proposal, thinking on the timeline, a background test, persisted', async () => {
    vi.useFakeTimers();
    const fetchMock = model();
    vi.stubGlobal('fetch', fetchMock);
    const { hooks } = installNative();
    const { result } = renderHook(() => useAssist());
    await act(() => vi.advanceTimersByTimeAsync(10));
    await act(() => result.current.shareScreen());
    act(() => hooks.onFrame!(frame()));
    enableWatcher(result);
    await act(() => vi.advanceTimersByTimeAsync(5000 * 3 + 100));
    expect(watcherCalls(fetchMock)).toBeGreaterThanOrEqual(2);
    // A static screen: the same notes and proposal every round are kept once.
    expect(result.current.watcher.notes.map((n) => n.text)).toEqual(['Files sidebar item at the left', 'An ad covers the top right']);
    expect(result.current.watcher.proposals).toHaveLength(1);
    expect(result.current.timeline.some((e) => e.step === 'Screen watcher' && e.thinking === 'watching')).toBe(true);
    // Its background test ran once (no bridge here, so it failed) and fed the pattern system.
    expect(result.current.watcher.tests).toHaveLength(1);
    expect(result.current.watcher.tests[0]).toMatchObject({ verdict: 'failed', dryRun: true });
    expect(result.current.watcher.tests[0].tried).toMatch(/Dry-run click on "Files sidebar item"/);
    expect(result.current.patterns.some((p) => p.kind === 'avoid' && /Files sidebar item/.test(p.pattern))).toBe(true);
    expect(result.current.history).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem('droid-assist.watcher')!).notes).toHaveLength(2);
  });

  it('makes no model call while off, and none without a live capture', async () => {
    vi.useFakeTimers();
    const fetchMock = model();
    vi.stubGlobal('fetch', fetchMock);
    const { hooks } = installNative();
    const { result } = renderHook(() => useAssist());
    await act(() => vi.advanceTimersByTimeAsync(10));
    await act(() => result.current.shareScreen());
    act(() => hooks.onFrame!(frame()));
    await act(() => vi.advanceTimersByTimeAsync(12_000));
    expect(watcherCalls(fetchMock)).toBe(0);
    act(() => hooks.onError!('Display disconnected'));
    enableWatcher(result);
    await act(() => vi.advanceTimersByTimeAsync(12_000));
    expect(watcherCalls(fetchMock)).toBe(0);
  });

  it('pauses while the executor is running, then resumes', async () => {
    vi.useFakeTimers();
    const fetchMock = model();
    let release: () => void = () => undefined;
    let hung = false;
    // The AI-help call hangs until released, keeping the executor busy (later calls carry it in their session history).
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => (!hung && String(init.body).includes('Where is search')
      ? new Promise<Response>((resolve) => { hung = true; release = () => resolve(new Response(JSON.stringify({ message: { role: 'assistant', content: '{"answer":"Top","items":[]}' } }))); })
      : fetchMock(url, init))));
    const { hooks } = installNative();
    const { result } = renderHook(() => useAssist());
    await act(() => vi.advanceTimersByTimeAsync(10));
    await act(() => result.current.shareScreen());
    act(() => hooks.onFrame!(frame()));
    let asking: Promise<void> = Promise.resolve();
    act(() => {
      asking = result.current.askScreen('Where is search?');
    });
    enableWatcher(result);
    await act(() => vi.advanceTimersByTimeAsync(12_000));
    expect(result.current.aiBusy).toBe(true);
    expect(watcherCalls(fetchMock)).toBe(0);
    await act(async () => {
      release();
      await asking;
    });
    await act(() => vi.advanceTimersByTimeAsync(5100));
    expect(watcherCalls(fetchMock)).toBe(1);
  });

  const stored = (p: Record<string, unknown>) => localStorage.setItem('droid-assist.watcher', JSON.stringify({ notes: [], tests: [], proposals: [{ id: 'p1', time: 1, status: 'pending', ...p }] }));

  it('dry-run test on the demo desktop while disarmed: logged, nothing dispatched', async () => {
    stored({ kind: 'familiar', text: 'Save Files as familiar', target: 'Files icon', x: 0.42, y: 0.5 });
    const { result } = renderHook(() => useAssist());
    await act(() => result.current.testProposal('p1'));
    expect(result.current.watcher.tests[0]).toMatchObject({ proposalId: 'p1', verdict: 'passed', dryRun: true });
    expect(result.current.watcher.tests[0].happened).toMatch(/dry run, not dispatched/);
    expect(result.current.log.some((l) => l.source === 'Screen watcher' && /Test passed: Dry-run click/.test(l.message))).toBe(true);
    expect(result.current.history).toHaveLength(0);
    expect(result.current.cursor).toBeNull();
    expect(result.current.patterns).toHaveLength(0);
  });

  it('armed test is a real click through the gate; aborted refuses it', async () => {
    stored({ kind: 'familiar', text: 'Save Files as familiar', target: 'Files icon', x: 0.42, y: 0.97 });
    const { result } = renderHook(() => useAssist());
    act(() => result.current.toggleArmed());
    await act(() => result.current.testProposal('p1'));
    expect(result.current.watcher.tests[0]).toMatchObject({ dryRun: false });
    expect(result.current.cursor).toEqual({ x: 0.42, y: 0.97 });
    act(() => result.current.triggerAbort('test'));
    await act(() => result.current.testProposal('p1'));
    expect(result.current.watcher.tests[0]).toMatchObject({ verdict: 'failed', happened: expect.stringMatching(/Aborted/) });
  });

  it('accepting a familiar proposal saves the element; dismissing is logged', () => {
    stored({ kind: 'familiar', text: 'Save Files as familiar', target: 'Files icon', x: 0.42, y: 0.97 });
    const { result } = renderHook(() => useAssist());
    act(() => result.current.acceptProposal('p1'));
    expect(result.current.familiar).toMatchObject([{ name: 'Files icon', x: 0.42, y: 0.97 }]);
    expect(result.current.watcher.proposals[0].status).toBe('accepted');
    expect(result.current.log[0].message).toMatch(/Accepted .*familiar/);
    act(() => result.current.dismissProposal('p1'));
    expect(result.current.watcher.proposals[0].status).toBe('accepted');
  });

  it('accepting a reorder edits the steps; a pattern proposal becomes a learned pattern; dismiss logs', () => {
    localStorage.setItem('droid-assist.watcher', JSON.stringify({ notes: [], tests: [], proposals: [
      { id: 'r', time: 1, status: 'pending', kind: 'reorder', text: 'Flow fails at step 2 — move it first', from: 2, to: 1 },
      { id: 'a', time: 1, status: 'pending', kind: 'pattern', text: 'avoid clicking the ad banner' },
      { id: 'c', time: 1, status: 'pending', kind: 'close_popup', text: 'Popup keeps returning', target: 'close X', x: 0.9, y: 0.1 },
    ] }));
    const { result } = renderHook(() => useAssist());
    act(() => result.current.setSteps([{ id: 's1', name: 'One', action: 'wait', x: 0, y: 0, status: 'pending' }, { id: 's2', name: 'Two', action: 'wait', x: 0, y: 0, status: 'pending' }]));
    act(() => result.current.acceptProposal('r'));
    expect(result.current.steps.map((s) => s.id)).toEqual(['s2', 's1']);
    act(() => result.current.acceptProposal('a'));
    expect(result.current.patterns[0]).toMatchObject({ kind: 'avoid', pattern: 'clicking the ad banner' });
    act(() => result.current.dismissProposal('c'));
    expect(result.current.watcher.proposals.find((p) => p.id === 'c')?.status).toBe('dismissed');
    expect(result.current.log[0].message).toMatch(/Dismissed "Popup keeps returning"/);
  });
});
