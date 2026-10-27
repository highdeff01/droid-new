import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssist } from './use-assist.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const reply = (content: string) => Promise.resolve(new Response(JSON.stringify({ message: { role: 'assistant', content } }), { status: 200 }));
const hang = (init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
const CALC_PLAN = (expr: string) => `{"steps":[{"name":"Compute ${expr}","action":"calc","text":"${expr}","x":0.5,"y":0.5}]}`;

/**
 * A model for the crew: the main AI (crew prompt) answers `decisions` in order; an agent's plan
 * call answers a calc step for its task (or hangs when `hangAgents`); every other prompt a plain answer.
 */
function crewModel(decisions: string[], hangAgents = false) {
  const calls: Array<{ body: string; signal: AbortSignal }> = [];
  const hung: AbortSignal[] = [];
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
    const body = String(init.body);
    calls.push({ body, signal: init.signal! });
    if (body.includes('directing a crew')) return reply(decisions.shift() ?? '{"done":true,"summary":"no more","commands":[]}');
    if (body.includes('crew task') && hangAgents) {
      hung.push(init.signal!);
      return hang(init);
    }
    if (body.includes('crew task')) return reply(CALC_PLAN(body.includes('crew task one') ? '1+1' : '2+2'));
    if (body.includes('reviewing a step')) return reply('Computed.');
    const content = body.includes('final verdict') ? '{"success":true,"pattern_avoid":null,"pattern_add":null}' : body.includes('Reply with OK') ? 'OK' : '{"patterns":[]}';
    return reply(content);
  }));
  return { calls, hung, count: (part: string) => calls.filter((c) => c.body.includes(part)).length };
}

async function mount(settings: Record<string, unknown> = {}) {
  localStorage.setItem('droid-assist.settings', JSON.stringify({ autoContinue: false, ...settings }));
  const { result } = renderHook(() => useAssist());
  await act(async () => {});
  return result;
}

const TWO_AGENTS = '{"done":false,"summary":"split","commands":[{"agent":"agent-1","task":"crew task one"},{"agent":"agent-3","task":"crew task two"}]}';

describe('/crew: the AI-directed command loop', () => {
  it('assigns agents, they work and report, the main AI decides again with the reports, and the reports become watcher notes', async () => {
    const m = crewModel([TWO_AGENTS, '{"done":true,"summary":"both computed","commands":[]}']);
    const result = await mount();
    act(() => result.current.setGoal('/crew compute two sums'));
    await act(() => result.current.submitInput());
    expect(m.count('directing a crew')).toBe(2);
    expect(m.count('crew task one')).toBeGreaterThanOrEqual(1);
    const second = m.calls.filter((c) => c.body.includes('directing a crew'))[1].body;
    expect(second).toMatch(/agent-1 \(ok\) on \\"crew task one\\"/);
    expect(second).toMatch(/agent-3 \(ok\) on \\"crew task two\\"/);
    expect(result.current.crew.find((a) => a.id === 'agent-1')).toMatchObject({ status: 'waiting', task: 'crew task one' });
    expect(result.current.crew.find((a) => a.id === 'agent-2')).toMatchObject({ status: 'waiting', task: null });
    expect(result.current.watcher.notes.map((n) => n.text)).toEqual(expect.arrayContaining([expect.stringMatching(/^Crew agent-1 \(ok\) on "crew task one"/), expect.stringMatching(/^Crew agent-3 \(ok\) on "crew task two"/)]));
    expect(result.current.log.find((l) => l.source === 'Agent crew' && /^Crew done/.test(l.message))?.message).toMatch(/after 2 round\(s\), 2 report\(s\) — both computed/);
    expect(result.current.crewRunning).toBe(false);
  });

  it('stops at Max iterations rounds', async () => {
    const m = crewModel(Array(5).fill('{"done":false,"summary":"","commands":[{"agent":"agent-2","task":"crew task one"}]}'));
    const result = await mount({ maxIterations: 2 });
    await act(() => result.current.runCrewGoal('keep going'));
    expect(m.count('directing a crew')).toBe(2);
    expect(result.current.log.some((l) => l.source === 'Agent crew' && /^Crew cap after 2 round/.test(l.message))).toBe(true);
  });

  it('is gated by its loop-control stage and by the abort latch', async () => {
    const m = crewModel([TWO_AGENTS]);
    const result = await mount();
    act(() => result.current.toggleStage('crew', false));
    await act(() => result.current.runCrewGoal('x'));
    expect(result.current.log[0].message).toMatch(/Agent crew stage is unchecked/);
    act(() => result.current.toggleStage('crew', true));
    act(() => result.current.triggerAbort('test'));
    await act(() => result.current.runCrewGoal('x'));
    expect(result.current.log[0].message).toMatch(/ABORTED is active/);
    expect(m.count('directing a crew')).toBe(0);
  });
});

describe('Stop plan', () => {
  it('halts the crew mid-work: cancels the in-flight agent calls and parks the agents, without disarming or latching ABORTED', async () => {
    const m = crewModel([TWO_AGENTS], true);
    const result = await mount({ autoAct: true });
    act(() => result.current.toggleArmed());
    let run!: Promise<void>;
    act(() => {
      run = result.current.runCrewGoal('compute two sums');
    });
    await vi.waitFor(() => expect(m.hung.length).toBeGreaterThanOrEqual(2));
    expect(result.current.crewRunning).toBe(true);
    act(() => result.current.stopPlan());
    expect(m.hung.every((s) => s.aborted)).toBe(true);
    await act(() => run);
    expect(m.count('directing a crew')).toBe(1);
    expect(result.current.crew.every((a) => a.status === 'parked')).toBe(true);
    expect(result.current.aborted).toBe(false);
    expect(result.current.armed).toBe(true);
    expect(result.current.settings.autoAct).toBe(true);
    expect(result.current.log.some((l) => l.source === 'Stop plan' && /crew agents parked.*stays armed, monitor and watchers keep running/.test(l.message))).toBe(true);
    expect(result.current.crewRunning).toBe(false);
  });

  it('halts a replay plan mid-step without the ABORTED latch, and the next plan runs with fresh AI calls', async () => {
    const calls: Array<{ body: string; signal: AbortSignal }> = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      const body = String(init.body);
      calls.push({ body, signal: init.signal! });
      if (body.includes('reviewing a step')) return hang(init);
      return reply(body.includes('final verdict') ? '{"success":true,"pattern_avoid":null,"pattern_add":null}' : body.includes('Reply with OK') ? 'OK' : body.includes('state WHAT') ? '{"ready":true,"x":0.5,"y":0.5,"why":"the planned step serves the goal"}' : '{"patterns":[]}');
    }));
    const result = await mount();
    act(() => result.current.setSteps([{ id: 's1', name: 'Calc', action: 'calc', text: '2+2', x: 0.5, y: 0.5, status: 'pending' }, { id: 's2', name: 'Calc 2', action: 'calc', text: '3+3', x: 0.5, y: 0.5, status: 'pending' }]));
    let run!: Promise<void>;
    act(() => {
      run = result.current.replay(false);
    });
    await vi.waitFor(() => expect(calls.some((c) => c.body.includes('reviewing a step'))).toBe(true));
    act(() => result.current.stopPlan());
    expect(calls.find((c) => c.body.includes('reviewing a step'))!.signal.aborted).toBe(true);
    await act(() => run);
    expect(calls.filter((c) => c.body.includes('reviewing a step'))).toHaveLength(1);
    expect(result.current.steps[1].status).toBe('pending');
    expect(result.current.aborted).toBe(false);
    act(() => result.current.setGoal('/crew x'));
    expect(result.current.dispatch.reason).not.toMatch(/abort/i);
  });

  it('is a separate control from the emergency stop', async () => {
    crewModel([]);
    const result = await mount();
    act(() => result.current.stopPlan());
    expect(result.current.aborted).toBe(false);
    act(() => result.current.stopAi());
    expect(result.current.aborted).toBe(true);
  });
});

describe('Live drag controls', () => {
  it('is off by default, persisted as a setting, and a loop-control stage', async () => {
    const result = await mount();
    expect(result.current.settings.liveDrag).toBe(false);
    expect(result.current.settings.stages.dragTrackers).toBe(true);
    act(() => result.current.setSettings({ ...result.current.settings, liveDrag: true }));
    expect(result.current.settings.liveDrag).toBe(true);
  });

  it('a user intervention with no live drag in progress changes nothing and says so', async () => {
    const result = await mount();
    act(() => result.current.interveneDrag({ x: 0.5, y: 0.5 }));
    expect(result.current.log[0]).toMatchObject({ source: 'Live drag', message: 'No live drag in progress — nothing to adjust', tone: 'warn' });
  });
});
