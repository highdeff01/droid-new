import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssist } from './use-assist.js';

vi.mock('./grounding.js', async (orig) => ({ ...(await orig<typeof import('./grounding.js')>()), boxedFrames: vi.fn(async (f: unknown) => ({ full: f, crop: f })) }));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** The engine with the AI endpoint unreachable (so tests, not a ruling, settle disagreements). */
async function offlineEngine() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).endsWith('/api/health')) return json({ ok: true });
    throw new TypeError('Failed to fetch');
  }));
  const { result } = renderHook(() => useAssist());
  await act(async () => {});
  return result;
}

const centerLog = (result: { current: ReturnType<typeof useAssist> }) => result.current.log.filter((l) => l.source === 'Resolution center').map((l) => l.message);

describe('resolution center in the engine', () => {
  it('detects the main plan and a bus agent disagreeing, settles it by a test and feeds the outcome back', async () => {
    localStorage.setItem('droid-assist.familiar', JSON.stringify([{ id: 'el1', name: 'Notes tab', x: 0.71, y: 0.4, lastSeen: 1 }]));
    const result = await offlineEngine();
    act(() => result.current.setSteps([{ id: 's1', name: 'Click Notes', action: 'click', target: 'Notes tab', x: 0.1, y: 0.1, status: 'pending' }]));
    act(() => result.current.forwardElement('screen', { name: 'notes  TAB', x: 0.7, y: 0.4 }));
    expect(result.current.resolution.disagreements).toHaveLength(1);
    expect(result.current.resolution.disagreements[0].reports.map((r) => r.reporter).sort()).toEqual(['main', 'screen']);
    await act(() => result.current.resolution.resolveAll());
    const [res] = result.current.resolution.resolutions;
    expect(res).toMatchObject({ via: 'test', element: 'Notes tab' });
    expect(res.winner?.reporter).toBe('screen');
    expect(result.current.steps[0]).toMatchObject({ x: 0.7, y: 0.4 });
    expect(result.current.resolution.disagreements).toEqual([]);
    expect(centerLog(result).some((m) => m.startsWith('Resolved by test: Use "Notes tab" at x=0.700, y=0.400'))).toBe(true);
    expect(result.current.patterns.some((p) => p.kind === 'add' && p.pattern.includes('Notes tab'))).toBe(true);
    expect(result.current.habits.some((h) => h.target === 'Notes tab' && h.successes === 1)).toBe(true);
    expect(result.current.history).toHaveLength(0);
  });

  it('a test that confirms no report (off-screen point, nothing known) leaves it unresolved and the plan untouched', async () => {
    const result = await offlineEngine();
    act(() => result.current.setSteps([{ id: 's1', name: 'Click Notes', action: 'click', target: 'Notes tab', x: 0.5, y: 0.5, status: 'pending' }]));
    act(() => result.current.forwardElement('screen', { name: 'Notes tab', x: 2.5, y: -3 }));
    await act(() => result.current.resolution.resolveAll());
    expect(result.current.resolution.resolutions[0]).toMatchObject({ via: 'unresolved', winner: null });
    expect(result.current.steps[0]).toMatchObject({ x: 0.5, y: 0.5 });
    expect(result.current.patterns.some((p) => p.kind === 'avoid' && p.pattern.includes('Notes tab'))).toBe(true);
  });

  it('settles a new disagreement on its own, without the Resolve button, applies the result and logs it', async () => {
    localStorage.setItem('droid-assist.familiar', JSON.stringify([{ id: 'el1', name: 'Save button', x: 0.31, y: 0.62, lastSeen: 1 }]));
    const result = await offlineEngine();
    act(() => result.current.setSteps([{ id: 's1', name: 'Click Save', action: 'click', target: 'Save button', x: 0.9, y: 0.9, status: 'pending' }]));
    await act(async () => {
      result.current.forwardElement('drift', { name: 'save button', x: 0.3, y: 0.62 });
    });
    await vi.waitFor(() => expect(result.current.resolution.resolutions).toHaveLength(1));
    expect(result.current.resolution.resolutions[0]).toMatchObject({ via: 'test', element: 'Save button' });
    expect(result.current.steps[0]).toMatchObject({ x: 0.3, y: 0.62 });
    expect(result.current.resolution.disagreements).toEqual([]);
    expect(centerLog(result).some((m) => m.startsWith('Resolved by test: Use "Save button" at x=0.300, y=0.620'))).toBe(true);
    expect(centerLog(result)).not.toContain('No disagreements between the main AI and the agents');
  });

  it('does not re-run an unresolved disagreement automatically until a newer report arrives; the button still re-runs it', async () => {
    const result = await offlineEngine();
    act(() => result.current.setSteps([{ id: 's1', name: 'Click Notes', action: 'click', target: 'Notes tab', x: 0.5, y: 0.5, status: 'pending' }]));
    await act(async () => {
      result.current.forwardElement('screen', { name: 'Notes tab', x: 2.5, y: -3 });
    });
    await vi.waitFor(() => expect(result.current.resolution.resolutions).toHaveLength(1));
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(result.current.resolution.resolutions).toHaveLength(1);
    await act(() => result.current.resolution.resolveAll());
    expect(result.current.resolution.resolutions).toHaveLength(2);
    expect(result.current.resolution.resolutions.every((r) => r.via === 'unresolved')).toBe(true);
  });

  it('agreeing reports are no disagreement', async () => {
    const result = await offlineEngine();
    act(() => result.current.setSteps([{ id: 's1', name: 'Click Notes', action: 'click', target: 'Notes tab', x: 0.1, y: 0.1, status: 'pending' }]));
    act(() => result.current.forwardElement('drift', { name: 'Notes tab', x: 0.12, y: 0.11 }));
    expect(result.current.resolution.disagreements).toEqual([]);
  });
});

describe('recovery operations in the engine', () => {
  it('queues admin maintenance behind approval; reject never runs it, approve runs it disarmed as a dry run', async () => {
    const result = await offlineEngine();
    const queued = await act(() => result.current.resolution.runOp('maintenance', 'backup'));
    expect(queued.message).toMatch(/queued — waiting for approval/);
    expect(result.current.resolution.ops).toEqual([]);
    const [first] = result.current.resolution.approvals;
    await act(() => result.current.resolution.reject(first.id));
    expect(result.current.resolution.ops).toEqual([]);
    await act(() => result.current.resolution.runOp('maintenance', 'backup'));
    await act(() => result.current.resolution.approve(result.current.resolution.approvals[0].id));
    expect(result.current.resolution.ops[0]).toMatchObject({ op: 'maintenance', arg: 'backup' });
    // Disarmed: only entries labeled as dry runs — nothing dispatched.
    expect(result.current.history.length).toBeGreaterThan(0);
    expect(result.current.history.every((h) => h.dryRun && h.message.includes('dry run — not dispatched'))).toBe(true);
  });

  it('real-input operations refuse while aborted', async () => {
    const result = await offlineEngine();
    act(() => result.current.toggleArmed());
    act(() => result.current.triggerAbort('test'));
    const out = await act(() => result.current.resolution.runOp('rechat', 'ChatGPT: which button saves?'));
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/Aborted/);
    expect(result.current.history).toHaveLength(0);
  });

  it('app creation scaffolds within the sandboxed script rules and refuses a rule break', async () => {
    const result = await offlineEngine();
    const bad = await act(() => result.current.resolution.runOp('createApp', 'Wiper: rm -rf /'));
    expect(bad).toMatchObject({ ok: false });
    expect(bad.message).toMatch(/sandboxed script rules/);
    const good = await act(() => result.current.resolution.runOp('createApp', 'Hello Tool: console.log("hi")'));
    expect(good.ok).toBe(true);
    expect(result.current.resolution.scaffolds[0].files.map((f) => f.path)).toEqual(['hello-tool/main.js', 'hello-tool/README.md']);
    expect(result.current.patterns.some((p) => p.kind === 'avoid' && p.pattern.startsWith('App creation'))).toBe(true);
  });

  it('reconnect re-establishes the bridge and logs the attempts', async () => {
    localStorage.setItem('droid-assist.settings', JSON.stringify({ bridgeUrl: 'http://pc' }));
    const result = await offlineEngine();
    const out = await act(() => result.current.resolution.runOp('reconnect'));
    expect(out).toEqual({ ok: true, message: 'Bridge reconnected after 1 attempt(s)' });
    expect(centerLog(result)).toContain('Reconnect: Bridge reconnected after 1 attempt(s)');
  });
});
