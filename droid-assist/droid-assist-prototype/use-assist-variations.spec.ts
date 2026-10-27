import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssist } from './use-assist.js';
import { variationActor } from './variations.js';
import type { WorkflowStep } from './types.js';

vi.mock('./grounding.js', async (orig) => ({ ...(await orig<typeof import('./grounding.js')>()), boxedFrames: vi.fn(async (f: unknown) => ({ full: f, crop: f })) }));

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

const calc = (id: string, text: string): WorkflowStep => ({ id, name: `Calc ${text}`, action: 'calc', text, x: 0.5, y: 0.5, status: 'pending' });
const cards = [
  { id: 'c1', name: 'Add two and two', description: '', savedAt: 1, steps: [calc('s1', '2+2'), calc('s2', '3+3')] },
  { id: 'c2', name: 'Multiply nine by nine', description: '', savedAt: 2, steps: [calc('s3', '9*9')] },
];

type Engine = { current: ReturnType<typeof useAssist> };

/** The engine on the demo desktop with two saved flows, AI offline. */
async function mount(): Promise<Engine> {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  localStorage.setItem('droid-assist.cards', JSON.stringify(cards));
  const { result } = renderHook(() => useAssist());
  await act(async () => {});
  act(() => result.current.useDemo());
  return result;
}

/** Plans `goal` from the matching saved flow. */
async function plan(r: Engine, goal: string) {
  act(() => r.current.setGoal(goal));
  await act(() => r.current.autoPlan(goal));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('useAssist background variations', () => {
  it('steers a superseded goal into a background variation with its own portfolio record', async () => {
    const r = await mount();
    await plan(r, 'add two and two');
    expect(r.current.variations.variations).toHaveLength(0);
    await plan(r, 'multiply nine by nine');
    const [v] = r.current.variations.variations;
    expect(v).toMatchObject({ goal: 'add two and two', status: 'running' });
    expect(v.steps.map((s) => s.text)).toEqual(['2+2', '3+3']);
    expect(r.current.steps.map((s) => s.text)).toEqual(['9*9']);
    const own = r.current.knowledge.portfolios.filter((e) => e.actor === variationActor(v.id));
    expect(own[0]).toMatchObject({ kind: 'work', source: { operation: 'add two and two', opId: variationActor(v.id) } });
  });

  it('holds background work while aborted or while its loop-control stage is unchecked, and runs it otherwise', async () => {
    const r = await mount();
    await plan(r, 'add two and two');
    await plan(r, 'multiply nine by nine');
    act(() => r.current.triggerAbort('test'));
    await act(() => r.current.variations.tick());
    expect(r.current.variations.held).toMatch(/Aborted/);
    expect(r.current.variations.variations[0].steps.every((s) => s.status === 'pending')).toBe(true);
    act(() => r.current.clearAbort());
    act(() => r.current.toggleStage('variations', false));
    await act(() => r.current.variations.tick());
    expect(r.current.variations.held).toMatch(/Background variations stage is unchecked/);
    act(() => r.current.toggleStage('variations', true));
    await act(() => r.current.variations.tick());
    expect(r.current.variations.held).toBeNull();
    expect(r.current.variations.variations[0].steps[0].status).toBe('done');
    expect(r.current.steps.map((s) => s.status)).toEqual(['pending']);
  });

  it('starts a new variation from the current project and merges it back', async () => {
    const r = await mount();
    await plan(r, 'add two and two');
    act(() => r.current.variations.startVariation());
    expect(r.current.goal).toBe('');
    expect(r.current.steps).toEqual([]);
    const [v] = r.current.variations.variations;
    await plan(r, 'multiply nine by nine');
    expect(r.current.variations.variations).toHaveLength(1);
    act(() => r.current.variations.merge(v.id));
    expect(r.current.variations.variations).toHaveLength(0);
    expect(r.current.steps.map((s) => s.text)).toEqual(['9*9', '2+2', '3+3']);
  });
});
