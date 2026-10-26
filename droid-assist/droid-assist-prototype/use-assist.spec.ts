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

  it('records the plan thought, reflection and verdict of a planned drag replayed on the demo desktop', async () => {
    const replies: Record<string, Record<string, unknown>> = {
      plan: { content: '{"steps":[{"name":"Drag Report to Archive","action":"drag","target":"Report file","x":0.9,"y":0.2,"endTarget":"Archive folder","endX":0.9,"endY":0.7}]}', thinking: 'Report is top-right.' },
      reflect: { content: 'The file is in the archive.', thinking: 'Filed.' },
      verdict: { content: '{"success":true,"pattern_avoid":null,"pattern_add":null}', thinking: 'Drag worked.' },
    };
    const pick = (body: string) => (body.includes('final verdict') ? 'verdict' : body.includes('reviewing a step') ? 'reflect' : 'plan');
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify({ message: { role: 'assistant', ...replies[pick(String(init.body))] } }), { status: 200 })));
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => result.current.setGoal('drag the report file onto the archive folder'));
    await act(() => result.current.autoPlan());
    expect(result.current.steps[0]).toMatchObject({ action: 'drag', target: 'Report file', endTarget: 'Archive folder', endX: 0.9, endY: 0.7 });
    act(() => result.current.toggleArmed());
    await act(() => result.current.replay());
    const kinds = result.current.timeline.filter((e) => e.step === 'Drag Report to Archive').map((e) => e.kind);
    expect(kinds).toEqual(['check', 'verdict', 'reflection']);
    expect(result.current.timeline.find((e) => e.kind === 'check' && e.step === 'Drag Report to Archive')?.text).toMatch(/^PASS — "Report file"/);
    expect(result.current.timeline.some((e) => e.kind === 'thought' && e.thinking === 'Report is top-right.')).toBe(true);
    expect(result.current.history[0]).toMatchObject({ action: 'drag', via: 'demo', ok: true, x: 864, y: 108, endX: 864, endY: 378 });
  });
});

describe('useAssist drag recorder and guardrails', () => {
  async function recordDrag() {
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => result.current.toggleRecording());
    act(() => result.current.onStageDrag({ x: 0.9, y: 0.2 }, { x: 0.4, y: 0.5 }));
    act(() => result.current.toggleRecording());
    return result;
  }

  it('records a real drag as one drag step with both endpoints', async () => {
    const result = await recordDrag();
    expect(result.current.steps).toHaveLength(1);
    expect(result.current.steps[0]).toMatchObject({ action: 'drag', x: 0.9, y: 0.2, endX: 0.4, endY: 0.5 });
  });

  it('replays a recorded drag on the demo desktop and logs both coordinates', async () => {
    const result = await recordDrag();
    act(() => result.current.toggleArmed());
    await act(() => result.current.replay());
    expect(result.current.steps[0].status).toBe('done');
    expect(result.current.history[0]).toMatchObject({ action: 'drag', via: 'demo', x: 864, y: 108, endX: 384, endY: 270 });
    expect(result.current.log.some((l) => /Dragged "Report"/.test(l.message))).toBe(true);
  });

  it('sends nothing when aborted', async () => {
    const result = await recordDrag();
    act(() => result.current.toggleArmed());
    act(() => result.current.triggerAbort('test'));
    await act(() => result.current.replay());
    expect(result.current.history).toHaveLength(0);
  });
});

describe('useAssist rearrangement on the demo desktop', () => {
  // Files starts at (0.055, 0.105), Game at (0.055, 0.425): "below Game" means the same column, lower.
  const plan = (endY: number, endX = 0.12) => ({ content: JSON.stringify({ steps: [{ name: 'Move Files', action: 'drag', target: 'Files icon', x: 0.055, y: 0.105, endTarget: 'free spot below Game', endX, endY }], expect: [{ element: 'Files icon', relation: 'below', anchor: 'Game' }] }), thinking: 'Files goes under Game.' });
  const replan = (fromY: number, endY: number, x = 0.12) => ({ content: JSON.stringify({ steps: [{ name: 'x', action: 'drag', target: 'Files icon', x, y: fromY, endTarget: 'free spot below Game', endX: x, endY }] }), thinking: 'Try again.' });

  function stubAi(first: Record<string, unknown>, again: Record<string, unknown>) {
    const replies: Record<string, Record<string, unknown>> = {
      plan: first,
      replan: again,
      reflect: { content: 'Moved.', thinking: null },
      verdict: { content: '{"success":true,"pattern_avoid":null,"pattern_add":null}', thinking: null },
    };
    const pick = (body: string) => (body.includes('final verdict') ? 'verdict' : body.includes('reviewing a step') ? 'reflect' : body.includes('correction of one drag') ? 'replan' : 'plan');
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify({ message: { role: 'assistant', ...replies[pick(String(init.body))] } }), { status: 200 })));
  }

  async function arrange(armed: boolean, before?: (r: { current: ReturnType<typeof useAssist> }) => void) {
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    if (armed) act(() => result.current.toggleArmed());
    before?.(result);
    act(() => result.current.setGoal('/arrange move the Files icon below Game'));
    await act(() => result.current.submitInput());
    return result;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('plans the drag with its arrangement, checks the move and verifies the arrangement with PASS per element', async () => {
    stubAi(plan(0.55), replan(0, 0));
    const result = await arrange(true);
    expect(result.current.steps[0]).toMatchObject({ action: 'drag', status: 'done', endX: 0.12, endY: 0.55 });
    expect(result.current.history).toHaveLength(1);
    expect(result.current.timeline.find((e) => e.step === 'Move Files' && e.kind === 'check')?.text).toMatch(/^PASS/);
    const verify = result.current.log.filter((l) => l.source === 'Verify');
    expect(verify.some((l) => /^PASS "Files icon" — .*below "Game" as requested/.test(l.message) && l.tone === 'ok')).toBe(true);
    expect(verify.some((l) => /Arrangement confirmed: 1\/1/.test(l.message))).toBe(true);
    expect(result.current.timeline.some((e) => e.step === 'Verify "Files icon"' && e.kind === 'check' && /^PASS/.test(e.text))).toBe(true);
  });

  it('re-plans a drag that missed once and passes on the retry', async () => {
    // 0.99 is clamped above the taskbar, so the first drop misses; the re-plan drags it from there.
    stubAi(plan(0.99), replan(0.885, 0.55));
    const result = await arrange(true);
    expect(result.current.history).toHaveLength(2);
    expect(result.current.steps[0].status).toBe('done');
    const checks = result.current.timeline.filter((e) => e.kind === 'check' && e.step === 'Move Files').map((e) => e.text.slice(0, 4));
    expect(checks).toEqual(['PASS', 'FAIL']);
    expect(result.current.log.some((l) => /retrying once/.test(l.message))).toBe(true);
  });

  it('marks the drag failed after one retry and the arrangement FAIL', async () => {
    // Both drops land clamped at (0.5, 0.885): off the drop point and not in Game's column.
    stubAi(plan(1, 0.5), replan(0.885, 1, 0.5));
    const result = await arrange(true);
    expect(result.current.history).toHaveLength(2);
    expect(result.current.steps[0].status).toBe('failed');
    expect(result.current.log.some((l) => l.source === 'Verify' && /^FAIL "Files icon"/.test(l.message) && l.tone === 'error')).toBe(true);
    expect(result.current.log.some((l) => /Arrangement NOT confirmed: 0\/1/.test(l.message))).toBe(true);
  });

  it('disarmed: a dry run sends nothing and runs no verification pass', async () => {
    stubAi(plan(0.55), replan(0, 0));
    const result = await arrange(false);
    expect(result.current.history).toHaveLength(0);
    expect(result.current.log.some((l) => l.source === 'Verify')).toBe(false);
  });

  it('aborted: nothing is dragged', async () => {
    stubAi(plan(0.55), replan(0, 0));
    const result = await arrange(true, (r) => act(() => r.current.triggerAbort('test')));
    expect(result.current.history).toHaveLength(0);
    expect(result.current.log.some((l) => l.source === 'Verify')).toBe(false);
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
