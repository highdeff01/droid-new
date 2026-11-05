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
const card = { id: 'c1', name: 'Nightly calc', description: 'add two and two', savedAt: 1, steps: [step] };
const schedule = (over: Partial<{ cooldownSec: number; maxRuns: number; everySec: number; at: number }> = {}) => ({
  kind: 'schedule' as const, name: 'Every second', target: { kind: 'card' as const, cardId: 'c1' }, cooldownSec: 0, maxRuns: 0, everySec: 1, at: Date.now(), ...over,
});

type Engine = { current: ReturnType<typeof useAssist> };
const triggerLog = (r: Engine) => r.current.log.filter((l) => l.source === 'Triggers').map((l) => l.message);

/** The engine on the demo desktop with the saved flow in the Library, AI offline. */
async function mount(): Promise<Engine> {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  localStorage.setItem('droid-assist.cards', JSON.stringify([card]));
  const { result } = renderHook(() => useAssist());
  await act(async () => {});
  act(() => result.current.useDemo());
  return result;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('useAssist triggers', () => {
  it('a due schedule fires its saved flow through the replay pipeline, logs fire and result, and persists the count', async () => {
    const result = await mount();
    act(() => result.current.addTrigger(schedule({ everySec: 0 })));
    await act(() => vi.advanceTimersByTimeAsync(1100));
    const msgs = triggerLog(result);
    expect(msgs.some((m) => /^Fired "Every second" \(scheduled for .*\) — running flow "Nightly calc", run 1/.test(m))).toBe(true);
    expect(msgs.some((m) => /"Every second" result: \d+\/1 step\(s\) verified as a dry run/.test(m))).toBe(true);
    expect(msgs.some((m) => /one-time schedule — disabled/.test(m))).toBe(true);
    // Disarmed: the same replay pipeline ran it as a dry run.
    expect(result.current.log.some((l) => l.source === 'Safety' && /Trigger "Every second" runs as a dry run/.test(l.message))).toBe(true);
    expect(result.current.history).toHaveLength(0);
    const stored = JSON.parse(localStorage.getItem('droid-assist.triggers')!);
    expect(stored[0]).toMatchObject({ runs: 1, enabled: false });
  });

  it('cooldown: a recurring schedule inside its cooldown is skipped and logged, then fires again once it ends', async () => {
    const result = await mount();
    act(() => result.current.addTrigger(schedule({ everySec: 1, cooldownSec: 3 })));
    await act(() => vi.advanceTimersByTimeAsync(1100));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(triggerLog(result).some((m) => /"Every second" skipped \(.*\): cooldown — \d s of 3 s left/.test(m))).toBe(true);
    expect(result.current.triggers[0].runs).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.triggers[0].runs).toBe(2);
  });

  it('run limit: the trigger disables itself after maxRuns fires', async () => {
    const result = await mount();
    act(() => result.current.addTrigger(schedule({ everySec: 1, maxRuns: 2 })));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(result.current.triggers[0]).toMatchObject({ runs: 2, enabled: false });
    expect(triggerLog(result).some((m) => /reached its run limit \(2\) — disabled/.test(m))).toBe(true);
  });

  it('disabled triggers never fire', async () => {
    const result = await mount();
    act(() => result.current.addTrigger(schedule()));
    act(() => result.current.toggleTrigger(result.current.triggers[0].id));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.triggers[0].runs).toBe(0);
    expect(triggerLog(result).some((m) => m.startsWith('Fired'))).toBe(false);
  });

  it('kill switch: while ABORTED a due trigger is skipped (not run) and logged under Safety', async () => {
    const result = await mount();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', shiftKey: true }));
    });
    expect(result.current.aborted).toBe(true);
    act(() => result.current.addTrigger(schedule()));
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(result.current.log.some((l) => l.source === 'Safety' && /"Every second" skipped .*ABORTED is active/.test(l.message))).toBe(true);
    expect(result.current.triggers[0].runs).toBe(0);
    expect(result.current.history).toHaveLength(0);
  });

  it('loop control: with the Executor stage unchecked an armed trigger fires but no step is executed', async () => {
    const result = await mount();
    act(() => result.current.toggleArmed());
    act(() => result.current.toggleStage('executor', false));
    act(() => result.current.addTrigger(schedule({ everySec: 0 })));
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(triggerLog(result).some((m) => /result: 0\/1 step\(s\) executed as real input/.test(m))).toBe(true);
    expect(result.current.history).toHaveLength(0);
  });

  it('a draft-card trigger with no draft card is skipped with the reason', async () => {
    const result = await mount();
    act(() => result.current.addTrigger({ ...schedule({ everySec: 0 }), target: { kind: 'draft' } }));
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(triggerLog(result).some((m) => /skipped .*cannot run — no draft card/.test(m))).toBe(true);
  });

  it('Run now during a manual replay is skipped — never two runs at once', async () => {
    const result = await mount();
    act(() => result.current.loadCard(card));
    act(() => result.current.addTrigger(schedule({ at: Date.now() + 3_600_000 })));
    let replaying: Promise<void> = Promise.resolve();
    await act(async () => {
      replaying = result.current.replay();
      await result.current.fireTrigger(result.current.triggers[0].id, 'run now');
    });
    await act(() => replaying);
    expect(triggerLog(result).some((m) => /"Every second" skipped \(run now\) — a run is in progress/.test(m))).toBe(true);
    expect(result.current.triggers[0].runs).toBe(0);
  });

  it('refuses a schedule with an invalid run time', async () => {
    const result = await mount();
    act(() => result.current.addTrigger(schedule({ at: Number.NaN })));
    expect(result.current.triggers).toHaveLength(0);
    expect(triggerLog(result)[0]).toMatch(/not created — set a valid run time/);
  });

  it('refuses an element trigger on an unknown element', async () => {
    const result = await mount();
    act(() => result.current.addTrigger({ kind: 'element', name: 'Ad shows', target: { kind: 'draft' }, cooldownSec: 0, maxRuns: 0, elementId: 'nope', event: 'appear' }));
    expect(result.current.triggers).toHaveLength(0);
    expect(triggerLog(result)[0]).toMatch(/not created — pick a mapped element/);
  });
});
