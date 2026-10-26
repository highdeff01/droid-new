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

  it('records the plan thought, reflection and verdict of a planned drag replayed on the demo desktop', async () => {
    const replies: Record<string, Record<string, unknown>> = {
      plan: { content: '{"steps":[{"name":"Drag Report to Archive","action":"drag","target":"Report file","x":0.9,"y":0.2,"endTarget":"Archive folder","endX":0.9,"endY":0.7}]}', thinking: 'Report is top-right.' },
      reflect: { content: 'The file is in the archive.', thinking: 'Filed.' },
      verdict: { content: '{"success":true,"pattern_avoid":null,"pattern_add":null}', thinking: 'Drag worked.' },
      propose: { content: '{"ready":true,"x":0.9,"y":0.2,"why":"filing the report is the goal itself."}', thinking: 'Report is still top-right.' },
    };
    const pick = (body: string) => (body.includes('final verdict') ? 'verdict' : body.includes('reviewing a step') ? 'reflect' : body.includes('state WHAT') ? 'propose' : 'plan');
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify({ message: { role: 'assistant', ...replies[pick(String(init.body))] } }), { status: 200 })));
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => result.current.setGoal('drag the report file onto the archive folder'));
    await act(() => result.current.autoPlan());
    expect(result.current.steps[0]).toMatchObject({ action: 'drag', target: 'Report file', endTarget: 'Archive folder', endX: 0.9, endY: 0.7 });
    act(() => result.current.toggleArmed());
    await act(() => result.current.replay());
    const kinds = result.current.timeline.filter((e) => e.step === 'Drag Report to Archive').map((e) => e.kind);
    expect(kinds).toEqual(['verdict', 'reflection', 'proposal']);
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

describe('useAssist re-plan loop guard and parse failures', () => {
  const planBody = (x: number) => ({ content: `{"steps":[{"name":"Hover Files","action":"move","target":"files icon","x":${x},"y":0.9}]}`, thinking: 'Files sits bottom-left.' });
  const isPlan = (init: RequestInit) => typeof init.body === 'string' && init.body.includes('Goal: move mouse to files icon');

  /** Stubs fetch: plan calls get `planReply(n)` for the n-th plan call, everything else a plain OK. */
  function stubModel(planReply: (n: number) => Record<string, unknown>) {
    let n = 0;
    const fn = vi.fn(async (_url: string, init: RequestInit) => {
      const message = isPlan(init) ? planReply(n++) : { content: 'OK' };
      return new Response(JSON.stringify({ message: { role: 'assistant', ...message } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fn);
    return { planCalls: () => fn.mock.calls.filter(([, init]) => isPlan(init)).length };
  }

  async function mount() {
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    return result;
  }

  const guardLogs = (result: Awaited<ReturnType<typeof mount>>) => result.current.log.filter((l) => l.source === 'Planner' && /Re-plan guard/.test(l.message));

  afterEach(() => vi.unstubAllGlobals());

  it('dedupes identical consecutive plans: logs once and skips further model calls', async () => {
    const model = stubModel(() => planBody(0.1));
    const result = await mount();
    for (let i = 0; i < 4; i++) await act(() => result.current.autoPlan('move mouse to files icon'));
    expect(model.planCalls()).toBe(2);
    expect(guardLogs(result).filter((l) => /identical/.test(l.message))).toHaveLength(1);
    expect(result.current.log.filter((l) => l.source === 'Planner' && l.tone === 'ok')).toHaveLength(1);
  });

  it('caps re-plans per goal at 3 on an unchanged screen and resumes after a new frame', async () => {
    const { hooks } = installNative();
    const model = stubModel((n) => planBody(0.1 + n / 20));
    const result = await mount();
    await act(() => result.current.shareScreen());
    act(() => hooks.onFrame!(frame()));
    for (let i = 0; i < 6; i++) await act(() => result.current.autoPlan('move mouse to files icon'));
    expect(model.planCalls()).toBe(4);
    expect(guardLogs(result).filter((l) => /cap/.test(l.message))).toHaveLength(1);
    act(() => hooks.onFrame!(frame()));
    await act(() => result.current.autoPlan('move mouse to files icon'));
    expect(model.planCalls()).toBe(5);
  });

  it('does not start a second plan while one is still in flight', async () => {
    const model = stubModel(() => planBody(0.1));
    const result = await mount();
    await act(() => Promise.all([result.current.autoPlan('move mouse to files icon'), result.current.autoPlan('move mouse to files icon')]));
    expect(model.planCalls()).toBe(1);
    expect(guardLogs(result).filter((l) => /still being thought out/.test(l.message))).toHaveLength(1);
  });

  it('logs prose instead of JSON as an AI parse failure and never shows it as a plan', async () => {
    const prose = `Thinking Process: 1. Analyze the request. ${'The user wants to move the mouse. '.repeat(20)}`;
    stubModel(() => ({ content: prose, thinking: 'hmm' }));
    const result = await mount();
    await act(() => result.current.autoPlan('move mouse to files icon'));
    const parse = result.current.log.filter((l) => l.source === 'AI parse');
    expect(parse).toHaveLength(1);
    expect(parse[0].tone).toBe('error');
    expect(parse[0].message).toContain('Thinking Process');
    expect(parse[0].message.length).toBeLessThan(prose.length);
    expect(result.current.steps).toHaveLength(0);
    expect(result.current.timeline[0]).toMatchObject({ kind: 'thought', text: '' });
    expect(result.current.timeline.some((e) => e.text.includes('Thinking Process'))).toBe(false);
  });
});

describe('useAssist auto-continue and AI stop', () => {
  const calc = (n: number) => ({ name: `Calc ${n}`, action: 'calc', text: `${n}+1`, x: 0.5, y: 0.5 });
  type Script = { checks: Array<{ complete: boolean; progress: boolean; reason: string }>; hangVerify?: boolean };

  /** A model that answers each prompt kind; verification answers come from `script.checks` in order. */
  function model(script: Script) {
    const signals: AbortSignal[] = [];
    const bodies: string[] = [];
    let plans = 0;
    const answer = (body: string): string => {
      if (body.includes('verifying whether the user')) return JSON.stringify(script.checks.length > 1 ? script.checks.shift() : script.checks[0]);
      if (body.includes('This is a continuation')) return JSON.stringify({ steps: [calc(10 + plans++)] });
      if (body.includes('final verdict')) return '{"success":true,"pattern_avoid":null,"pattern_add":null}';
      if (body.includes('reviewing a step')) return 'Fine.';
      if (body.includes('Reply with OK')) return 'OK';
      return '{"patterns":[]}';
    };
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      const body = String(init.body);
      bodies.push(body);
      signals.push(init.signal!);
      if (script.hangVerify && body.includes('verifying whether the user')) {
        return new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      }
      return Promise.resolve(new Response(JSON.stringify({ message: { role: 'assistant', content: answer(body), thinking: 'reasoning' } }), { status: 200 }));
    }));
    return { signals, bodies, plans: () => plans, verifies: () => bodies.filter((b) => b.includes('verifying whether the user')).length };
  }

  async function engineWith(settings: Record<string, unknown>) {
    localStorage.setItem('droid-assist.settings', JSON.stringify({ autoContinue: true, ...settings }));
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => {
      result.current.setGoal('add the numbers');
      result.current.setSteps([{ id: 's1', ...calc(1), action: 'calc', status: 'pending' }]);
    });
    return result;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('verifies the goal after the run, re-plans and continues until it is verified complete', async () => {
    const m = model({ checks: [{ complete: false, progress: true, reason: 'one sum left' }, { complete: true, progress: true, reason: 'both sums shown' }] });
    const result = await engineWith({});
    await act(() => result.current.replay(false));
    expect(m.verifies()).toBe(2);
    expect(m.plans()).toBe(1);
    const auto = result.current.log.filter((l) => l.source === 'Auto-continue').map((l) => l.message);
    expect(auto.some((x) => /Iteration 1 check: Goal not complete \(progress made\) — one sum left/.test(x))).toBe(true);
    expect(auto.some((x) => /Iteration 1 plan: 1 step\(s\) — calc "Calc 10"/.test(x))).toBe(true);
    expect(auto.some((x) => /Iteration 2 check: Goal COMPLETE/.test(x))).toBe(true);
    expect(auto[0]).toMatch(/Stopped after 1 continuation\(s\): Goal verified complete — both sums shown/);
    const steps = result.current.timeline.map((e) => e.step);
    expect(steps).toEqual(expect.arrayContaining(['Verify goal #1: add the numbers', 'Continue #1: add the numbers', 'Verify goal #2: add the numbers']));
    expect(result.current.continuing).toBe(false);
  });

  it('stops after two consecutive iterations with no verified progress and reports why', async () => {
    const m = model({ checks: [{ complete: false, progress: false, reason: 'nothing changed' }] });
    const result = await engineWith({});
    await act(() => result.current.replay(false));
    expect(m.verifies()).toBe(2);
    expect(m.plans()).toBe(1);
    const stop = result.current.log.find((l) => l.source === 'Auto-continue' && l.message.startsWith('Stopped'));
    expect(stop?.message).toMatch(/No verified progress in 2 consecutive iterations — nothing changed/);
    expect(stop?.tone).toBe('warn');
  });

  it('respects a persisted max-iteration cap', async () => {
    const m = model({ checks: [{ complete: false, progress: true, reason: 'more to do' }] });
    const result = await engineWith({ maxIterations: 2 });
    expect(result.current.settings.maxIterations).toBe(2);
    await act(() => result.current.replay(false));
    expect(m.plans()).toBe(2);
    expect(result.current.log.find((l) => l.message.startsWith('Stopped after'))?.message).toMatch(/Max iterations \(2\) reached/);
  });

  it('the emergency stop cancels the in-flight model call mid-verification; no further AI call is made', async () => {
    const m = model({ checks: [{ complete: false, progress: true, reason: '' }], hangVerify: true });
    const result = await engineWith({});
    let run!: Promise<void>;
    act(() => {
      run = result.current.replay(false);
    });
    await vi.waitFor(() => expect(m.verifies()).toBe(1));
    expect(result.current.aiWorking).toBe(true);
    expect(result.current.continuing).toBe(true);
    const calls = m.bodies.length;
    act(() => result.current.triggerAbort('stop button'));
    await act(() => run);
    expect(m.signals[m.signals.length - 1].aborted).toBe(true);
    expect(m.bodies.length).toBe(calls);
    expect(m.plans()).toBe(0);
    expect(result.current.aborted).toBe(true);
    expect(result.current.aiStatus.state).not.toBe('offline');
    expect(result.current.log.some((l) => l.source === 'Auto-continue' && /cancelled by the user/.test(l.message))).toBe(true);
    expect(result.current.continuing).toBe(false);
  });

  it('the hotkey and the AI Stop button also cancel the in-flight call, and later calls are not pre-cancelled', async () => {
    const m = model({ checks: [{ complete: false, progress: true, reason: '' }], hangVerify: true });
    const result = await engineWith({});
    let run!: Promise<void>;
    act(() => {
      run = result.current.replay(false);
    });
    await vi.waitFor(() => expect(m.verifies()).toBe(1));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', shiftKey: true }));
    });
    await act(() => run);
    expect(m.signals[m.signals.length - 1].aborted).toBe(true);
    act(() => result.current.clearAbort());
    act(() => result.current.setSteps([{ id: 's2', ...calc(2), action: 'calc', status: 'pending' }]));
    act(() => {
      run = result.current.replay(false);
    });
    await vi.waitFor(() => expect(m.verifies()).toBe(2));
    expect(m.signals[m.signals.length - 1].aborted).toBe(false);
    act(() => result.current.stopAi());
    await act(() => run);
    expect(m.signals[m.signals.length - 1].aborted).toBe(true);
    expect(result.current.aborted).toBe(true);
  });
});

describe('useAssist loop control', () => {
  const ALL_STAGES = ['planner', 'grounding', 'executor', 'reflect', 'verdict', 'autoContinue', 'screenResponder', 'popup', 'drift', 'progress', 'goal', 'screenWatcher', 'coords', 'supervisor', 'elementMap', 'subagents'] as const;

  /** A model whose reflection call hangs until cancelled; every other prompt gets a plain answer. */
  function hangingReflect() {
    const calls: Array<{ body: string; signal: AbortSignal }> = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      const body = String(init.body);
      calls.push({ body, signal: init.signal! });
      if (body.includes('reviewing a step')) {
        return new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      }
      const content = body.includes('final verdict') ? '{"success":true,"pattern_avoid":null,"pattern_add":null}' : body.includes('Reply with OK') ? 'OK' : body.includes('state WHAT') ? '{"ready":true,"x":0.5,"y":0.5,"why":"the planned step serves the goal"}' : '{"patterns":[]}';
      return Promise.resolve(new Response(JSON.stringify({ message: { role: 'assistant', content } }), { status: 200 }));
    }));
    return { calls, count: (part: string) => calls.filter((c) => c.body.includes(part)).length };
  }

  async function mount() {
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    return result;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('unchecking Reflect cancels its in-flight model call at once, skips the verdict and logs the toggle', async () => {
    const m = hangingReflect();
    const result = await mount();
    act(() => result.current.setSteps([{ id: 's1', name: 'Calc', action: 'calc', text: '2+2', x: 0.5, y: 0.5, status: 'pending' }]));
    let run!: Promise<void>;
    act(() => {
      run = result.current.replay(false);
    });
    await vi.waitFor(() => expect(m.count('reviewing a step')).toBe(1));
    const reflectCall = m.calls.find((c) => c.body.includes('reviewing a step'))!;
    expect(reflectCall.signal.aborted).toBe(false);
    act(() => result.current.toggleStage('reflect', false));
    expect(reflectCall.signal.aborted).toBe(true);
    await act(() => run);
    expect(m.count('final verdict')).toBe(0);
    expect(result.current.aborted).toBe(false);
    expect(result.current.settings.stages.reflect).toBe(false);
    const entry = result.current.log.find((l) => l.source === 'Loop control');
    expect(entry).toMatchObject({ message: 'Reflect disabled — its in-flight AI calls were cancelled', tone: 'warn' });
    expect(typeof entry?.time).toBe('number');
    expect(JSON.parse(localStorage.getItem('droid-assist.settings')!).stages.reflect).toBe(false);
  });

  it('cancelling one stage leaves the other stages\' calls alone, and re-checking logs an enable', async () => {
    hangingReflect();
    const result = await mount();
    act(() => result.current.toggleStage('popup', false));
    act(() => result.current.toggleStage('popup', true));
    const msgs = result.current.log.filter((l) => l.source === 'Loop control').map((l) => [l.message, l.tone]);
    expect(msgs).toEqual([['Popup watcher enabled', 'ok'], ['Popup watcher disabled — its in-flight AI calls were cancelled', 'warn']]);
  });

  it('an unchecked Planner makes no model call and says why', async () => {
    const m = hangingReflect();
    const result = await mount();
    act(() => result.current.toggleStage('planner', false));
    const before = m.calls.length;
    await act(() => result.current.autoPlan('open the files app'));
    expect(m.calls.length).toBe(before);
    expect(result.current.steps).toHaveLength(0);
    expect(result.current.log.find((l) => l.source === 'Planner')?.message).toMatch(/Planner stage is unchecked in Loop control/);
  });

  it('hydrates the stage map on startup', async () => {
    hangingReflect();
    localStorage.setItem('droid-assist.settings', JSON.stringify({ stages: { drift: false } }));
    const result = await mount();
    expect(result.current.settings.stages.drift).toBe(false);
    expect(result.current.settings.stages.reflect).toBe(true);
  });

  it('guardrails still fire with every stage unchecked: the hotkey aborts and an aborted Test click reports the abort', async () => {
    hangingReflect();
    const result = await mount();
    act(() => ALL_STAGES.forEach((id) => result.current.toggleStage(id, false)));
    expect(Object.values(result.current.settings.stages).every((v) => v === false)).toBe(true);
    const el = { id: 'el1', name: 'Files icon', x: 0.42, y: 0.97, source: 'familiar' as const };
    await act(() => result.current.testClick(el));
    expect(result.current.log.find((l) => l.source === 'Test click')?.message).toMatch(/H6 .*dry run/);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', shiftKey: true }));
    });
    expect(result.current.aborted).toBe(true);
    act(() => result.current.toggleArmed());
    await act(() => result.current.testClick(el));
    expect(result.current.log.find((l) => l.source === 'Test click')?.message).toMatch(/Aborted/);
    expect(result.current.history).toHaveLength(0);
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
    act(() => result.current.toggleStage('screenWatcher', true));

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is a loop-control stage beside the pipeline and the other agents', () => {
    const { result } = renderHook(() => useAssist());
    expect(result.current.settings.stages.screenWatcher).toBe(true);
    expect(Object.keys(result.current.settings.stages)).toEqual(expect.arrayContaining(['planner', 'popup', 'screenWatcher', 'coords', 'supervisor']));
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

  it('makes no model call while its stage is off, and none without a live capture', async () => {
    vi.useFakeTimers();
    const fetchMock = model();
    vi.stubGlobal('fetch', fetchMock);
    const { hooks } = installNative();
    const { result } = renderHook(() => useAssist());
    await act(() => vi.advanceTimersByTimeAsync(10));
    await act(() => result.current.shareScreen());
    act(() => hooks.onFrame!(frame()));
    act(() => result.current.toggleStage('screenWatcher', false));
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
    // Only Accept saves the element; a test leaves the proposal pending and memory untouched.
    expect(result.current.familiar).toHaveLength(0);
    expect(result.current.watcher.proposals[0].status).toBe('pending');
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
