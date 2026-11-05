import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssist } from './use-assist.js';
import type { NativeCaptureApi, NativeFrame } from './electron/capture-api.js';
import type { Frame, WorkflowStep } from './types.js';
import { selfTestStep, testTargets } from './self-test.js';
import type { MappedElement } from './element-map-studio.js';

vi.mock('./grounding.js', async (orig) => ({ ...(await orig<typeof import('./grounding.js')>()), boxedFrames: vi.fn(async (f: unknown) => ({ full: f, crop: f })) }));

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

type Engine = { current: ReturnType<typeof useAssist> };

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
    grabDisplay: vi.fn(),
  };
  window.droidNative = api;
  return hooks;
}

/** PLAY sits at (0.5, 0.62) on the demo desktop. */
const play = { id: 'el1', name: 'Play button', x: 0.5, y: 0.62, lastSeen: 1 };
const offline = () => vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
const initiativeLog = (r: Engine) => r.current.log.filter((l) => l.source === 'AI initiative').map((l) => l.message);

/** The engine on the demo desktop, AI offline, with the Play button as a familiar element. */
async function mountDemo(): Promise<Engine> {
  offline();
  localStorage.setItem('droid-assist.familiar', JSON.stringify([play]));
  const { result } = renderHook(() => useAssist());
  await act(async () => {});
  return result;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.droidNative;
  localStorage.clear();
});

describe('AI initiative: periodic scanning', () => {
  const findings = JSON.stringify({
    findings: [
      { kind: 'popup', text: 'Cookie banner left open', action: 'click', target: 'Accept cookies', cell: 'G6', cx: 0.5, cy: 0.5 },
      { kind: 'incomplete', text: 'Signup form half filled' },
      { kind: 'bogus', text: 'dropped' },
    ],
  });
  const model = () => vi.fn(async (_url: string, init: RequestInit) => {
    const content = (init.body as string).includes('initiative scanner') ? findings : 'OK';
    return new Response(JSON.stringify({ message: { role: 'assistant', content, thinking: 'scanning' } }), { status: 200 });
  });
  const scans = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter(([, init]) => ((init as RequestInit).body as string).includes('initiative scanner')).length;

  async function mountLive(fetchMock: ReturnType<typeof vi.fn>, scanSec = 20): Promise<Engine> {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
    const hooks = installNative();
    const { result } = renderHook(() => useAssist());
    await act(() => vi.advanceTimersByTimeAsync(10));
    act(() => result.current.setSettings((s) => ({ ...s, scanSec })));
    await act(() => result.current.shareScreen());
    act(() => hooks.onFrame!(frame()));
    return result;
  }

  it('scans on the user interval and proposes (never performs) handling popups and incomplete states', async () => {
    const fetchMock = model();
    const result = await mountLive(fetchMock);
    await act(() => vi.advanceTimersByTimeAsync(19_000));
    expect(scans(fetchMock)).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(scans(fetchMock)).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(scans(fetchMock)).toBe(2);
    const scanProposals = result.current.initiative.proposals.filter((p) => p.category === 'scan');
    // Repeated findings are proposed once; the unknown kind is dropped.
    expect(scanProposals.map((p) => p.text)).toEqual(['[incomplete] Signup form half filled', '[popup] Cookie banner left open']);
    expect(scanProposals.every((p) => p.status === 'pending')).toBe(true);
    expect(scanProposals[1].step).toMatchObject({ action: 'click', target: 'Accept cookies' });
    expect(initiativeLog(result).some((m) => /proposed "\[popup\] Cookie banner left open" \(auto-apply is off/.test(m))).toBe(true);
    expect(result.current.timeline.some((e) => e.step === 'Initiative scan' && e.thinking === 'scanning')).toBe(true);
    expect(result.current.history).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem('droid-assist.initiative')!).proposals.length).toBeGreaterThanOrEqual(2);
  });

  it('scans sooner when the AI asks to, but never later than the user interval', async () => {
    const reply = JSON.stringify({ findings: [], next_scan_sec: 7 });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify({ message: { role: 'assistant', content: (init.body as string).includes('initiative scanner') ? reply : 'OK' } }), { status: 200 }));
    const result = await mountLive(fetchMock, 30);
    await act(() => vi.advanceTimersByTimeAsync(30_500));
    expect(scans(fetchMock)).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(7_500));
    expect(scans(fetchMock)).toBe(2);
    expect(result.current.settings.scanSec).toBe(30);
  });

  it('auto-apply on but disarmed: an input action still stays a proposal', async () => {
    const fetchMock = model();
    const result = await mountLive(fetchMock);
    act(() => result.current.setSettings((s) => ({ ...s, initiativeAutoApply: { ...s.initiativeAutoApply, scan: true } })));
    await act(() => vi.advanceTimersByTimeAsync(21_000));
    const popup = result.current.initiative.proposals.find((p) => p.text.startsWith('[popup]'))!;
    expect(popup.status).toBe('pending');
    expect(initiativeLog(result).some((m) => /Cookie banner left open" \(real input is disarmed\)/.test(m))).toBe(true);
    // A finding without an input action needs no arming: auto-applied as a note.
    expect(result.current.initiative.proposals.find((p) => p.text.startsWith('[incomplete]'))!.status).toBe('applied');
    expect(result.current.history).toHaveLength(0);
  });

  it('makes no scan while its loop-control stage is unchecked', async () => {
    const fetchMock = model();
    const result = await mountLive(fetchMock);
    act(() => result.current.toggleStage('initiativeScan', false));
    await act(() => vi.advanceTimersByTimeAsync(65_000));
    expect(scans(fetchMock)).toBe(0);
  });
});

describe('AI initiative: self-testing and the heavy element tester', () => {
  it('sets up a self-test of a familiar element as a proposal; accepting runs it through the agent pipeline as a dry run while disarmed', async () => {
    const result = await mountDemo();
    act(() => result.current.setSettings((s) => ({ ...s, selfTestMode: 'foreground' })));
    await act(() => result.current.initiativeScanNow());
    const test = result.current.initiative.proposals.find((p) => p.category === 'selfTest')!;
    expect(test).toMatchObject({ status: 'pending', text: 'Test that "Play button" still clicks correctly', step: { action: 'click', target: 'Play button', x: 0.5, y: 0.62 } });
    await act(() => result.current.acceptInitiative(test.id));
    expect(result.current.initiative.proposals.find((p) => p.id === test.id)!.status).toBe('applied');
    expect(initiativeLog(result).some((m) => m.startsWith('Self-test: accepted "Test that "Play button" still clicks correctly"') && m.includes('dry run — not dispatched'))).toBe(true);
    expect(result.current.highlight).toMatchObject({ label: 'Play button' });
    // Disarmed: only entries labeled as dry runs — nothing dispatched.
    expect(result.current.history.length).toBeGreaterThan(0);
    expect(result.current.history.every((h) => h.dryRun && h.message.includes('dry run — not dispatched'))).toBe(true);
  }, 20_000);

  it('refuses to self-test while ABORTED', async () => {
    const result = await mountDemo();
    act(() => result.current.triggerAbort('test'));
    await act(() => result.current.initiativeScanNow());
    expect(result.current.initiative.proposals).toHaveLength(0);
  });

  it('the heavy element tester runs click/type/drag cycles, reports reliability and appends a run summary', async () => {
    const result = await mountDemo();
    act(() => result.current.setSettings((s) => ({ ...s, stressCycles: 2 })));
    await act(async () => {
      await result.current.stressTest({ name: 'Play button', x: 0.5, y: 0.62 });
    });
    const [report] = result.current.initiative.stress;
    expect(report).toMatchObject({ target: 'Play button', attempts: 6, dryRun: true });
    expect(report.byAction).toEqual({ click: { ok: 2, total: 2 }, type: { ok: 2, total: 2 }, drag: { ok: 2, total: 2 } });
    expect(report.reliability).toBe(1);
    expect(result.current.runs[0]).toMatchObject({ goal: 'Stress test "Play button"', outcome: 'dry-run', attempted: 6 });
    // Dry-run cycles do not train habits (only real input does).
    expect(result.current.habits.some((h) => h.target === 'Play button')).toBe(false);
    // Disarmed: only entries labeled as dry runs — nothing dispatched.
    expect(result.current.history.length).toBeGreaterThan(0);
    expect(result.current.history.every((h) => h.dryRun && h.message.includes('dry run — not dispatched'))).toBe(true);
  }, 30_000);

  it('a guardrail refusal is not measured as unreliability: no report, no run summary', async () => {
    const result = await mountDemo();
    act(() => result.current.toggleStage('executor', false));
    let report: unknown = 'unset';
    await act(async () => {
      report = await result.current.stressTest({ name: 'Play button', x: 0.5, y: 0.62 });
    });
    expect(report).toBeUndefined();
    expect(result.current.initiative.stress).toHaveLength(0);
    expect(result.current.runs).toHaveLength(0);
    expect(initiativeLog(result).some((m) => /^Stress test of "Play button" stopped — /.test(m))).toBe(true);
  }, 20_000);

  it('a self-test of a mapped element carries the screenshot it was mapped on', () => {
    const frame = { id: 7 } as unknown as Frame;
    const [t] = testTargets([{ name: 'Save', box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, frame } as unknown as MappedElement], []);
    expect(selfTestStep(t).refFrame).toBe(frame);
  });
});

describe('AI initiative: workflow creation and workarounds', () => {
  const click: WorkflowStep = { id: 'c', name: 'Press play', action: 'click', target: 'Play button', x: 0.5, y: 0.62, status: 'pending' };

  it('a successful run becomes a candidate, is agent-verified, then proposed as a pack; accepting saves it to the Library', async () => {
    const result = await mountDemo();
    act(() => result.current.setGoal('play the demo video'));
    const ref = { id: 1, time: 0, url: '', data: new ImageData(new Uint8ClampedArray(320 * 180 * 4), 320, 180), srcW: 1920, srcH: 1080, source: 'demo' } as Frame;
    act(() => result.current.setSteps([{ ...click, refFrame: ref }]));
    await act(() => result.current.replay(false));
    expect(initiativeLog(result).some((m) => /learned candidate ".*" \(1 step\(s\)\) — an agent verifies it before it is proposed/.test(m))).toBe(true);
    expect(result.current.initiative.proposals.filter((p) => p.category === 'workflow')).toHaveLength(0);
    await act(() => result.current.initiativeScanNow());
    const pack = result.current.initiative.proposals.find((p) => p.category === 'workflow')!;
    expect(pack.status).toBe('pending');
    expect(pack.text).toMatch(/^New workflow ".*" \(1 step\(s\), agent-verified\)$/);
    expect(pack.pack!.checks[0]).toMatch(/^PASS "Press play"/);
    expect(pack.pack!.checks).toHaveLength(1);
    await act(() => result.current.acceptInitiative(pack.id));
    expect(result.current.cards.some((c) => c.name === pack.pack!.name && c.steps.length === 1)).toBe(true);
    // The same sequence again is already known: no second pack.
    await act(() => result.current.replay(false));
    await act(() => result.current.initiativeScanNow());
    expect(result.current.initiative.proposals.filter((p) => p.category === 'workflow')).toHaveLength(1);
  }, 30_000);

  it('a dry-run sequence with no screenshot of its target is not proposed: the agent cannot confirm the target', async () => {
    const result = await mountDemo();
    act(() => result.current.setGoal('press the ghost'));
    act(() => result.current.setSteps([{ ...click, name: 'Press ghost', target: 'Ghost', x: 0.03, y: 0.03 }]));
    await act(() => result.current.replay(false));
    await act(() => result.current.initiativeScanNow());
    expect(result.current.initiative.proposals.filter((p) => p.category === 'workflow')).toHaveLength(0);
    expect(initiativeLog(result).some((m) => /not proposed — agent verification failed: FAIL "Press ghost" — no reference screenshot/.test(m))).toBe(true);
  }, 20_000);

  it('with Workflow creation unchecked nothing is learned', async () => {
    const result = await mountDemo();
    act(() => result.current.toggleStage('workflowCreation', false));
    act(() => result.current.setSteps([click]));
    await act(() => result.current.replay(false));
    await act(() => result.current.initiativeScanNow());
    expect(result.current.initiative.proposals.filter((p) => p.category === 'workflow')).toHaveLength(0);
  }, 20_000);

  it('a failed step gets a logged workaround proposal; auto-apply edits the workflow', async () => {
    const result = await mountDemo();
    act(() => result.current.setSettings((s) => ({ ...s, initiativeAutoApply: { ...s.initiativeAutoApply, workaround: true } })));
    // A drag with no drop point really fails (nothing is dispatched).
    const bad: WorkflowStep = { id: 'b', name: 'Bad drag', action: 'drag', x: 0.3, y: 0.4, status: 'pending' };
    act(() => result.current.setSteps([bad]));
    await act(() => result.current.replay(false));
    const w = result.current.initiative.proposals.find((p) => p.category === 'workaround')!;
    expect(w.text).toMatch(/^After "Bad drag" failed: add step 1 "Wait before "Bad drag"" \(wait\)/);
    expect(w.status).toBe('applied');
    expect(result.current.steps.map((s) => s.action)).toEqual(['wait', 'drag']);
    expect(result.current.initiative.log.some((l) => l.category === 'workaround' && /auto-applied/.test(l.text))).toBe(true);
  }, 20_000);
});
