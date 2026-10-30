import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBridgeV2, type BridgeV2Deps } from './use-bridge-v2.js';
import type { MainBridge } from './main-bridge.js';
import type { InboundMessage } from './main-bridge-protocol.js';
import type { WorkflowStep } from './types.js';
import { TAKEOVER_MS } from './takeover.js';

type Sent = { type: string; payload: Record<string, unknown>; replyTo?: string };

function fakeBridge() {
  const sent: Sent[] = [];
  const bridge = {
    send: vi.fn(async (type: string, payload: Record<string, unknown>, replyTo?: string) => {
      sent.push({ type, payload, replyTo });
      return { ok: true, message: `Sent ${type}` };
    }),
  } as unknown as MainBridge;
  return { bridge, sent };
}

const step = (name: string, status: WorkflowStep['status'], target?: string): WorkflowStep => ({ id: `s-${name}`, name, action: 'click', x: 0.2, y: 0.3, status, ...(target ? { target } : {}) });

function makeDeps(bridge: MainBridge, patch: Partial<BridgeV2Deps> = {}): BridgeV2Deps {
  return {
    bridge: () => bridge,
    connected: true,
    steps: [],
    running: false,
    activeIndex: null,
    armed: false,
    aiOnline: () => true,
    crewSize: 25,
    knownElements: [],
    bus: [],
    goal: () => 'open settings',
    recentLog: () => [{ id: 'l1', time: 1, source: 'Replay', message: 'clicked', tone: 'info' }],
    addLog: vi.fn(),
    forwardElement: vi.fn(),
    machinery: {
      analyze: vi.fn(async (q: string) => ({ ok: true, message: `analysed ${q}` })),
      plan: vi.fn(async (g: string) => ({ ok: true, message: `planned ${g}` })),
      run: vi.fn(async () => ({ ok: true, message: 'ran' })),
      verify: vi.fn(async () => ({ ok: false, message: 'not yet' })),
      watch: vi.fn(async (on: boolean) => ({ ok: true, message: on ? 'watching' : 'stopped' })),
      assistError: vi.fn(async () => ({ ok: true, message: 'recorded' })),
    },
    regulate: { pause: vi.fn(), stop: vi.fn(), resume: vi.fn(), setArmed: vi.fn(), setMode: vi.fn() },
    plan: vi.fn(async () => true),
    disputedElements: [],
    arbitrate: vi.fn(),
    act: vi.fn(async () => undefined),
    ...patch,
  };
}

const msg = (type: string, payload: unknown, id = `m-${type}`) => ({ v: 2, id, time: 1, type, payload }) as unknown as InboundMessage;
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useBridgeV2 — v2 request routing', () => {
  it('routes run_workflow into the machinery, answers with a result replying to the request and logs the app decision', async () => {
    const { bridge, sent } = fakeBridge();
    const deps = makeDeps(bridge);
    const { result } = renderHook(() => useBridgeV2(deps));
    let handled = false;
    act(() => { handled = result.current.onMessage(msg('run_workflow', { goal: 'export report', selfTest: true }, 'req-7')); });
    await flush();
    expect(handled).toBe(true);
    expect(deps.machinery.run).toHaveBeenCalledWith('export report', true);
    expect(sent.find((s) => s.type === 'result')).toMatchObject({ payload: { ok: true, message: 'ran' }, replyTo: 'req-7' });
    expect(vi.mocked(deps.addLog).mock.calls.some(([source]) => source === 'App selection')).toBe(true);
  });

  it('leaves v1 messages to the existing handlers', () => {
    const { bridge } = fakeBridge();
    const { result } = renderHook(() => useBridgeV2(makeDeps(bridge)));
    expect(result.current.onMessage({ v: 1, id: 'h', time: 1, type: 'hello', payload: { app: 'MainDroid' } } as InboundMessage)).toBe(false);
  });
});

describe('useBridgeV2 — user requests both ways', () => {
  it('a user request from droid-main is planned in droid-new and listed as from-main', () => {
    const { bridge } = fakeBridge();
    const deps = makeDeps(bridge);
    const { result } = renderHook(() => useBridgeV2(deps));
    act(() => { result.current.onMessage(msg('user_request', { text: 'rename the file', from: 'droid-main' })); });
    expect(deps.plan).toHaveBeenCalledWith('rename the file');
    expect(result.current.flows[0]).toMatchObject({ direction: 'from-main', text: 'rename the file' });
  });

  it('a user request typed in droid-new goes to droid-main as user_request', async () => {
    const { bridge, sent } = fakeBridge();
    const { result } = renderHook(() => useBridgeV2(makeDeps(bridge)));
    await act(async () => { await result.current.sendUserRequest('  check the inbox '); });
    expect(sent.find((s) => s.type === 'user_request')?.payload).toEqual({ text: 'check the inbox', from: 'droid-new' });
    expect(result.current.flows[0]).toMatchObject({ direction: 'to-main', text: 'check the inbox' });
  });
});

describe('useBridgeV2 — regulation both ways', () => {
  it('droid-main regulate commands act on droid-new', () => {
    const { bridge } = fakeBridge();
    const deps = makeDeps(bridge);
    const { result } = renderHook(() => useBridgeV2(deps));
    act(() => {
      result.current.onMessage(msg('regulate', { command: 'disarm' }, 'r1'));
      result.current.onMessage(msg('regulate', { command: 'mode', mode: 'aggressive' }, 'r2'));
    });
    expect(deps.regulate.setArmed).toHaveBeenCalledWith(false);
    expect(deps.regulate.setMode).toHaveBeenCalledWith('aggressive');
  });

  it('droid-new regulates droid-main with a regulate message', async () => {
    const { bridge, sent } = fakeBridge();
    const { result } = renderHook(() => useBridgeV2(makeDeps(bridge)));
    await act(async () => { await result.current.regulateMain('pause'); });
    expect(sent.find((s) => s.type === 'regulate')?.payload).toMatchObject({ command: 'pause' });
  });
});

describe('useBridgeV2 — takeover flow', () => {
  it('hands the first step to droid-main with full context when it is not verified complete within 10 s', async () => {
    const { bridge, sent } = fakeBridge();
    const deps = makeDeps(bridge, { steps: [step('Open menu', 'running'), step('Click save', 'pending')] });
    const { result } = renderHook(() => useBridgeV2(deps));
    act(() => { vi.advanceTimersByTime(TAKEOVER_MS - 100); });
    expect(sent.some((s) => s.type === 'takeover')).toBe(false);
    act(() => { vi.advanceTimersByTime(200); });
    await flush();
    const takeover = sent.find((s) => s.type === 'takeover');
    expect(takeover?.payload).toMatchObject({ goal: 'open settings', index: 0, step: 'Open menu', steps: ['Open menu', 'Click save'], log: ['[Replay] clicked'] });
    expect(result.current.agreements[0].owner).toBe('main');
  });

  it('does not hand off a first step that is complete (verified and both sides agree)', async () => {
    const { bridge, sent } = fakeBridge();
    const deps = makeDeps(bridge, { steps: [step('Open menu', 'done')] });
    const { result } = renderHook(() => useBridgeV2(deps));
    act(() => { result.current.onMessage(msg('step_opinion', { index: 0, step: 'Open menu', agree: true })); });
    expect(result.current.coordination[0].state).toBe('complete');
    act(() => { vi.advanceTimersByTime(TAKEOVER_MS + 1000); });
    await flush();
    expect(sent.some((s) => s.type === 'takeover')).toBe(false);
  });

  it('a verified step without droid-main agents agreeing is not complete', () => {
    const { bridge } = fakeBridge();
    const { result } = renderHook(() => useBridgeV2(makeDeps(bridge, { steps: [step('Open menu', 'done')] })));
    expect(result.current.coordination[0]).toMatchObject({ verified: true, state: 'awaiting agreement' });
  });

  it('sends droid-new agents\' opinion of a verified step to droid-main', async () => {
    const { bridge, sent } = fakeBridge();
    renderHook(() => useBridgeV2(makeDeps(bridge, { steps: [step('Open menu', 'done')] })));
    await flush();
    expect(sent.find((s) => s.type === 'step_opinion')?.payload).toMatchObject({ index: 0, step: 'Open menu', agree: true });
  });

  it('a disagreement goes to the resolution center with droid-new as arbiter', () => {
    const { bridge } = fakeBridge();
    const deps = makeDeps(bridge, { steps: [step('Open menu', 'done')] });
    const { result } = renderHook(() => useBridgeV2(deps));
    act(() => { result.current.onMessage(msg('step_opinion', { index: 0, step: 'Open menu', agree: false, note: 'menu still closed' })); });
    expect(result.current.coordination[0].state).toBe('disagreement');
    expect(deps.arbitrate).toHaveBeenCalledWith('Open menu', expect.stringContaining('droid-new (arbiter)'), true);
  });

  it('droid-main taking over a step on its own marks it owned by droid-main', () => {
    const { bridge } = fakeBridge();
    const { result } = renderHook(() => useBridgeV2(makeDeps(bridge, { steps: [step('Open menu', 'running'), step('Save', 'running')] })));
    act(() => { result.current.onMessage(msg('takeover', { reason: 'incomplete', goal: 'g', index: 1, step: 'Save', steps: ['Open menu', 'Save'], log: [] })); });
    expect(result.current.agreements.find((a) => a.index === 1)?.owner).toBe('main');
    expect(result.current.coordination[1].owner).toBe('main');
  });
});

describe('useBridgeV2 — browser logs and swarm', () => {
  it('droid-main console errors land in the browser logs and go to the error machinery', () => {
    const { bridge } = fakeBridge();
    const deps = makeDeps(bridge);
    const { result } = renderHook(() => useBridgeV2(deps));
    act(() => { result.current.onMessage(msg('console_log', { app: 'droid-main', level: 'error', message: 'TypeError: x is undefined' })); });
    expect(result.current.browserLogs[0]).toMatchObject({ app: 'droid-main', level: 'error', message: 'TypeError: x is undefined' });
    expect(deps.machinery.assistError).toHaveBeenCalledWith('TypeError: x is undefined', undefined);
    expect(deps.forwardElement).toHaveBeenCalled();
  });

  it('runs a swarm round on the 25-agent crew over both apps\' readings', () => {
    const { bridge } = fakeBridge();
    const deps = makeDeps(bridge, {
      knownElements: [{ name: 'Save', x: 0.1, y: 0.1 }],
      bus: [{ id: 'b1', time: 1, from: 'mainApp', to: 'goal', element: { name: 'Save', x: 0.105, y: 0.1 }, status: 'queued' }],
    });
    const { result } = renderHook(() => useBridgeV2(deps));
    let round = result.current.swarmRound;
    act(() => { round = result.current.runSwarm(); });
    expect(new Set(round!.tasks.map((t) => t.agentId)).size).toBe(25);
    expect(round!.consensus[0]).toMatchObject({ status: 'consensus', sources: ['assist', 'main'] });
  });
});
