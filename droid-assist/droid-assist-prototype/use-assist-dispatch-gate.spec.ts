import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssist } from './use-assist.js';
import type { WorkflowStep } from './types.js';
import { AI_DOWN_PAUSE, MODE_PAUSE } from './dispatch-gate.js';

vi.mock('./grounding.js', async (orig) => ({ ...(await orig<typeof import('./grounding.js')>()), boxedFrames: vi.fn(async (f: unknown) => ({ full: f, crop: f })) }));

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

type Engine = { current: ReturnType<typeof useAssist> };

const click6: WorkflowStep = { id: 'c6', name: 'Click 6', action: 'click', target: 'Click 6', x: 0.06, y: 0.599, status: 'pending' };
const AVOID = 'click "Click 6" failed after 3 attempt(s) at (6.0%, 59.9%): Click hit nothing interactive';
const avoidHabit = { id: 'h1', target: 'Click 6', context: '', attempts: 3, successes: 0, lastUsed: Date.now(), lessons: [{ kind: 'avoid', text: AVOID, time: Date.now() }], pinned: false };
const pack = (id: string, name: string, steps: WorkflowStep[]) => ({ id, name, kind: 'recorded', goal: '', goalSource: null, steps, tests: [], savedAt: 1 });
const region = { id: 'm1', name: 'region at R10C2', box: { x: 0.03, y: 0.57, w: 0.06, h: 0.06 }, mappedAt: 1 };

/** A model endpoint that is down until `up` is flipped; when up, proposals are ready and re-plans come back empty. */
function endpoint() {
  const state = { up: false };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (!state.up) throw new TypeError('quantumclaw unreachable');
    const body = String(init?.body ?? '');
    const content = body.includes('re-plan of one step') ? '{"steps":[]}'
      : body.includes('WHAT you will do') ? '{"ready":true,"x":0.06,"y":0.599,"why":"the pack says so"}' : 'OK';
    return new Response(JSON.stringify({ message: { role: 'assistant', content, thinking: null } }), { status: 200 });
  }));
  return state;
}

/** The engine on the demo desktop, armed, AI endpoint down, with the given packs, habits and element map stored. */
async function mount(store: { packs: unknown[]; habits?: unknown[]; map?: unknown[] }): Promise<{ result: Engine; ai: { up: boolean } }> {
  const ai = endpoint();
  localStorage.setItem('droid-assist.settings', JSON.stringify({ autoScan: false, autoContinue: false }));
  localStorage.setItem('droid-assist.packs', JSON.stringify(store.packs));
  if (store.habits) localStorage.setItem('droid-assist.habits', JSON.stringify(store.habits));
  if (store.map) localStorage.setItem('droid-assist.element-map', JSON.stringify(store.map));
  const { result } = renderHook(() => useAssist());
  await act(async () => {});
  await waitFor(() => expect(result.current.aiStatus.state).toBe('offline'));
  await waitFor(() => expect(result.current.packs.packs.length).toBe(store.packs.length));
  act(() => result.current.useDemo());
  act(() => result.current.toggleArmed());
  return { result, ai };
}

const logs = (r: Engine, re: RegExp) => r.current.log.filter((l) => re.test(l.message));
/** Starts a pack run without awaiting it (it may pause). */
const start = (r: Engine, id: string) => {
  let run: Promise<unknown> = Promise.resolve();
  act(() => {
    run = r.current.packs.runPack(id) ?? Promise.resolve();
  });
  return run;
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('dispatch gate: blacklisted actions', () => {
  it('a step with an active avoid entry for its target+point never dispatches; the reason is in the log and briefing', async () => {
    const { result } = await mount({ packs: [pack('p1', 'Click 6', [click6])], habits: [avoidHabit] });
    await act(() => start(result, 'p1'));
    expect(result.current.history).toHaveLength(0);
    expect(logs(result, /not dispatched — blacklisted — Habit avoid: .*Click hit nothing interactive/).length).toBeGreaterThan(0);
    const blocked = result.current.briefings.find((b) => b.outcome === 'blocked');
    expect(blocked?.blocked).toMatch(/blacklisted/);
    expect(result.current.steps[0].status).toBe('failed');
  });
});

describe('dispatch gate: stale coordinates', () => {
  it('a mapped element that is not the target over the point blocks dispatch and, with the AI down, pauses the run', async () => {
    const { result } = await mount({ packs: [pack('p1', 'Click 6', [click6])], map: [region] });
    const run = start(result, 'p1');
    await waitFor(() => expect(result.current.breaker.paused).toBe(AI_DOWN_PAUSE));
    expect(result.current.history).toHaveLength(0);
    expect(logs(result, /stale-blocked — stale coordinates — mapped element "region at R10C2" covers .* not "Click 6"/).length).toBeGreaterThan(0);
    expect(result.current.briefings.some((b) => b.outcome === 'blocked' && /stale coordinates/.test(b.blocked ?? ''))).toBe(true);
    act(() => result.current.stopPlan());
    await act(() => run);
    expect(result.current.history).toHaveLength(0);
  });
});

describe('AI-down circuit breaker', () => {
  it('pauses after 2 unresolved iterations with the endpoint down, notifies, and auto-resumes when the health check succeeds', async () => {
    const { result, ai } = await mount({ packs: [pack('p1', 'Click 6', [click6])], habits: [avoidHabit] });
    await act(() => start(result, 'p1'));
    expect(result.current.breaker).toEqual({ strikes: 1, paused: null });
    const second = start(result, 'p1');
    await waitFor(() => expect(result.current.breaker.paused).toBe(AI_DOWN_PAUSE));
    expect(logs(result, /paused: AI endpoint down; step needs re-grounding/).length).toBeGreaterThan(0);
    expect(result.current.notifications.some((n) => /paused: AI endpoint down/.test(n.title))).toBe(true);
    // Paused, the run does not keep retrying the failing click.
    const before = logs(result, /not dispatched/).length;
    await act(() => new Promise((r) => setTimeout(r, 600)));
    expect(logs(result, /not dispatched/).length).toBe(before);
    ai.up = true;
    await act(() => result.current.connectAi());
    await waitFor(() => expect(result.current.breaker.paused).toBeNull());
    expect(logs(result, /Resumed — AI endpoint health check succeeded/).length).toBe(1);
    await act(() => second);
    // Resumed with the AI up, the blocked step escalated once to the planner and then failed with why.
    expect(logs(result, /could not verify an unblocked alternative/).length).toBe(1);
    expect(logs(result, /failed — blacklisted .* re-plan could not produce a verifiable alternative/).length).toBeGreaterThan(0);
    expect(result.current.history).toHaveLength(0);
  });

  it('a paused run resumes when the user resumes it', async () => {
    const { result } = await mount({ packs: [pack('p1', 'Click 6', [click6])], map: [region] });
    const run = start(result, 'p1');
    await waitFor(() => expect(result.current.breaker.paused).toBe(AI_DOWN_PAUSE));
    act(() => result.current.resumeRun());
    expect(logs(result, /Resumed — resumed by the user/).length).toBe(1);
    act(() => result.current.stopPlan());
    await act(() => run);
  });
});

describe('Watching mode pauses pack dispatch', () => {
  const moves = [
    { id: 'm1', name: 'Move one', action: 'move', target: 'Files', x: 0.5, y: 0.5, status: 'pending' },
    { id: 'm2', name: 'Move two', action: 'move', target: 'Files', x: 0.52, y: 0.5, status: 'pending' },
  ] as WorkflowStep[];

  it('dispatches nothing while Watching, then resumes when another mode is selected; the mode change says so', async () => {
    const { result } = await mount({ packs: [pack('p2', 'Two moves', moves)] });
    act(() => result.current.setMode('watching', 'a movie is playing', 'ai'));
    expect(logs(result, /Watching .* dispatches paused/).length).toBe(1);
    const run = start(result, 'p2');
    await waitFor(() => expect(logs(result, new RegExp(MODE_PAUSE.replace(/[().]/g, '.'))).length).toBeGreaterThan(0));
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(result.current.history).toHaveLength(0);
    act(() => result.current.setMode('thoughtful', 'movie over', 'user'));
    expect(logs(result, /dispatches resumed/).length).toBe(1);
    await act(() => run);
    expect(result.current.history).toHaveLength(2);
  });

  it('a pack run with no goal derives one, shown in the briefing objectives', async () => {
    const { result } = await mount({ packs: [pack('p2', 'Two moves', moves)] });
    await act(() => start(result, 'p2'));
    expect(result.current.briefings[0].objectives.goal).toBe('Run pack "Two moves" (2 steps)');
  });
});
