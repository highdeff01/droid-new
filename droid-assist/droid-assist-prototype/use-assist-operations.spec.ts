import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssist } from './use-assist.js';
import type { WorkflowStep } from './types.js';

vi.mock('./grounding.js', async (orig) => ({ ...(await orig<typeof import('./grounding.js')>()), boxedFrames: vi.fn(async (f: unknown) => ({ full: f, crop: f })) }));

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

const step: WorkflowStep = { id: 's1', name: 'Calc', action: 'calc', text: '2+2', x: 0.5, y: 0.5, status: 'pending' };
const opsLog = (r: Engine) => r.current.log.filter((l) => l.source === 'Operations').map((l) => l.message);

type Engine = { current: ReturnType<typeof useAssist> };

/** The engine on the demo desktop with one step loaded, AI offline unless `fetchImpl` answers. */
async function mount(fetchImpl: (url: string) => Promise<Response> = async () => { throw new TypeError('offline'); }): Promise<Engine> {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => fetchImpl(String(url))));
  const { result } = renderHook(() => useAssist());
  await act(async () => {});
  act(() => result.current.useDemo());
  act(() => result.current.loadCard({ id: 'c1', name: 'Calc', description: '', savedAt: 1, steps: [step] }));
  return result;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('useAssist operations', () => {
  it('saves the current steps as a named operation and persists it under droid-assist.operations', async () => {
    const result = await mount();
    act(() => result.current.saveOperation('Open calculator', 'add two and two'));
    expect(result.current.operations).toHaveLength(1);
    expect(result.current.operations[0]).toMatchObject({ name: 'Open calculator', goal: 'add two and two', runs: 0 });
    await act(async () => {});
    const stored = JSON.parse(localStorage.getItem('droid-assist.operations') ?? '[]');
    expect(stored[0]).toMatchObject({ name: 'Open calculator', goal: 'add two and two' });
  });

  it('runs a saved operation through the replay pipeline as a dry run while disarmed', async () => {
    const result = await mount();
    act(() => result.current.saveOperation('Open calculator', 'add two and two'));
    let outcome: Awaited<ReturnType<typeof result.current.runOperation>> = null;
    await act(async () => {
      outcome = await result.current.runOperation(result.current.operations[0].id);
    });
    expect(outcome).toMatchObject({ dryRun: true, total: 1 });
    expect(result.current.history).toHaveLength(0);
    expect(result.current.log.some((l) => l.source === 'Safety' && /Operation "Open calculator" runs as a dry run/.test(l.message))).toBe(true);
  });

  it('a schedule trigger on an operation fires it', async () => {
    const result = await mount();
    act(() => result.current.saveOperation('Open calculator', 'add two and two'));
    const operationId = result.current.operations[0].id;
    act(() => result.current.addTrigger({ kind: 'schedule', name: 'Op timer', target: { kind: 'operation', operationId }, cooldownSec: 0, maxRuns: 0, everySec: 0, at: Date.now() }));
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(result.current.log.some((l) => l.source === 'Triggers' && /Fired "Op timer" .* running operation "Open calculator"/.test(l.message))).toBe(true);
  });

  it('playback says the main app does not support history when the route is missing, and loads nothing', async () => {
    const result = await mount(async (url) => (url.includes('/api/ai/action-history') ? json(404, {}) : json(200, {})));
    act(() => result.current.setSettings({ ...result.current.settings, bridgeUrl: 'http://pc' }));
    await act(() => result.current.loadPlayback());
    expect(opsLog(result).some((m) => m.includes('main app does not support playback history yet'))).toBe(true);
    expect(result.current.playback).toBeNull();
  });

  it('playback requests the window set in Settings (5 minutes)', async () => {
    const calls: string[] = [];
    const result = await mount(async (url) => {
      calls.push(url);
      return json(200, { success: true, history: [] });
    });
    act(() => result.current.setSettings({ ...result.current.settings, bridgeUrl: 'http://pc', playbackWindowSec: 300 }));
    await act(() => result.current.loadPlayback());
    expect(calls.some((u) => u.includes('/api/ai/action-history') && u.includes('windowSec=300'))).toBe(true);
    expect(result.current.playback?.windowSec).toBe(300);
  });

  it('retry with 0 retries set is skipped and logged', async () => {
    const result = await mount();
    act(() => result.current.saveOperation('Open calculator', 'add two and two'));
    act(() => result.current.setSettings({ ...result.current.settings, operationRetries: 0 }));
    await act(() => result.current.retryBest(result.current.operations[0].id));
    expect(opsLog(result).some((m) => /not retried — retries of detected operations are set to 0/.test(m))).toBe(true);
  });

  it('retries the best variant up to the set number of times, each verified and logged', async () => {
    const result = await mount();
    act(() => result.current.saveOperation('Open calculator', 'add two and two'));
    await act(() => result.current.retryBest(result.current.operations[0].id));
    const lines = opsLog(result);
    expect(lines.some((m) => /Retrying "Open calculator" as the best variant/.test(m))).toBe(true);
    expect(lines.filter((m) => /^Retry \d\/2 of "Open calculator" (verified|not verified):/.test(m)).length).toBeGreaterThanOrEqual(1);
  });
});
