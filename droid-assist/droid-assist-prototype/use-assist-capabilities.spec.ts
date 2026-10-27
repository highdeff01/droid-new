import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssist } from './use-assist.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** Every model call answers `content`; returns the fetch mock to inspect what was sent. */
function stubModel(content: string) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: { role: 'assistant', content, thinking: null } }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function engine() {
  const hook = renderHook(() => useAssist());
  await act(async () => {});
  return hook.result;
}

describe('useAssist capability registry — AI invocation', () => {
  it('sends the capability list with the plan and runs a capability-only plan as the AI, refusing guardrails', async () => {
    const fetchMock = stubModel(JSON.stringify({ steps: [], capabilities: [{ id: 'relax.set', params: { on: true } }, { id: 'guard.arm', params: { on: true } }] }));
    const result = await engine();
    act(() => result.current.setGoal('take it easy and arm yourself'));
    await act(() => result.current.autoPlan());
    const bodies = fetchMock.mock.calls.map((c) => String((c as unknown[])[1] && ((c as unknown[])[1] as RequestInit).body));
    expect(bodies.some((b) => b.includes('relax.set(on:boolean)'))).toBe(true);
    expect(bodies.some((b) => b.includes('guard.arm('))).toBe(false);
    expect(result.current.settings).toMatchObject({ captureMs: 2000, watchMs: 30000, autoAct: false });
    expect(result.current.relaxed).toBe(true);
    expect(result.current.armed).toBe(false);
    const [arm, relax] = result.current.invocations;
    expect(relax).toMatchObject({ requester: 'ai', id: 'relax.set', params: { on: true }, ok: true });
    expect(arm).toMatchObject({ requester: 'ai', id: 'guard.arm', ok: false, result: expect.stringMatching(/guardrail/) });
    expect(result.current.log.some((l) => l.source === 'Capabilities' && /ai → guard\.arm .*REFUSED/.test(l.message))).toBe(true);
  });

  it('restores the previous settings when relaxation mode is switched off', async () => {
    stubModel('{}');
    const result = await engine();
    const before = result.current.settings;
    await act(() => result.current.invoke('relax.set', { on: true }, { kind: 'ai' }));
    await act(() => result.current.invoke('relax.set', { on: false }, { kind: 'ai' }));
    expect(result.current.settings).toMatchObject({ captureMs: before.captureMs, watchMs: before.watchMs, monitorMode: before.monitorMode, autoAct: before.autoAct });
  });

  it('applies an in-range live adjustment at once and logs it; rejects an out-of-range one unchanged', async () => {
    stubModel('{}');
    const result = await engine();
    await act(() => result.current.invoke('setting.captureMs', { value: 1250 }, { kind: 'ai' }));
    await act(() => result.current.invoke('setting.aiView', { value: '1280x720' }, { kind: 'ai' }));
    await act(() => result.current.invoke('setting.monitorMode', { value: 'advanced' }, { kind: 'ai' }));
    expect(result.current.settings).toMatchObject({ captureMs: 1250, aiView: '1280x720', monitorMode: 'advanced' });
    expect(result.current.log.some((l) => l.source === 'Live adjust' && l.message === 'ai: captureMs: 500 → 1250')).toBe(true);
    const bad = await act(() => result.current.invoke('setting.stepRetries', { value: 99 }, { kind: 'ai' }));
    expect(bad).toMatchObject({ ok: false, result: expect.stringMatching(/within/) });
    expect(result.current.settings.stepRetries).not.toBe(99);
  });

  it('saves the current steps as a workflow on request and lists it', async () => {
    stubModel('{}');
    const result = await engine();
    expect(await act(() => result.current.invoke('workflow.save', { name: 'Run' }, { kind: 'ai' }))).toMatchObject({ ok: false, result: expect.stringMatching(/no steps/) });
    act(() => result.current.setSteps([{ id: 's', name: 'Click', action: 'click', x: 0.5, y: 0.5, status: 'pending' }]));
    await act(() => result.current.invoke('workflow.save', { name: 'My run' }, { kind: 'ai' }));
    expect(result.current.cards[0]).toMatchObject({ name: 'My run' });
    const listed = await act(() => result.current.invoke('workflow.list', {}, { kind: 'main-app' }));
    expect(listed.result).toMatch(/My run \(1 step\(s\)\)/);
  });
});

describe('useAssist capability registry — agent requests', () => {
  it('lets an agent run its own stage and stage-less features, refusing other stages and guardrails', async () => {
    stubModel('{}');
    const result = await engine();
    await act(() => result.current.requestCapability('screen', 'stage.screenWatcher', { on: false }));
    expect(result.current.settings.stages.screenWatcher).toBe(false);
    const other = await act(() => result.current.requestCapability('subagents', 'stage.planner', { on: false }));
    expect(other).toMatchObject({ ok: false, requester: 'agent:subagents' });
    expect(result.current.settings.stages.planner).toBe(true);
    const guard = await act(() => result.current.requestCapability('subagents', 'guard.abort', {}));
    expect(guard.ok).toBe(false);
    expect(result.current.aborted).toBe(false);
    const snip = await act(() => result.current.requestCapability('subagents', 'snip.capture', { x: 0, y: 0, w: 0.5, h: 0.5 }));
    expect(snip).toMatchObject({ ok: false, result: expect.stringMatching(/no captured frame/) });
  });

  it('lets the user (buttons) toggle guardrails through the same registry', async () => {
    stubModel('{}');
    const result = await engine();
    await act(() => result.current.invoke('guard.arm', { on: true }));
    expect(result.current.armed).toBe(true);
    expect(result.current.invocations[0]).toMatchObject({ requester: 'user', id: 'guard.arm', ok: true });
  });
});
