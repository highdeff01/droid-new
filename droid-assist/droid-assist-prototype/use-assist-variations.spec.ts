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

  it('steers steps replaced by a loaded flow into a variation that keeps their own goal', async () => {
    const r = await mount();
    await plan(r, 'add two and two');
    act(() => r.current.loadCard(r.current.cards.find((c) => c.id === 'c2')!));
    expect(r.current.variations.variations.map((v) => [v.goal, v.steps.map((s) => s.text)])).toEqual([['add two and two', ['2+2', '3+3']]]);
    await plan(r, 'multiply nine by nine');
    expect(r.current.variations.variations).toHaveLength(1);
    act(() => r.current.loadCard(r.current.cards.find((c) => c.id === 'c1')!));
    expect(r.current.variations.variations.map((v) => [v.goal.toLowerCase(), v.steps.map((s) => s.text)])).toContainEqual(['multiply nine by nine', ['9*9']]);
    expect(r.current.steps.map((s) => s.text)).toEqual(['2+2', '3+3']);
  });

  it('a new variation started after loading a flow keeps the loaded flow\'s goal with its steps', async () => {
    const r = await mount();
    await plan(r, 'add two and two');
    act(() => r.current.loadCard(r.current.cards.find((c) => c.id === 'c2')!));
    act(() => r.current.variations.startVariation());
    const pairs = r.current.variations.variations.map((v) => [v.goal.toLowerCase(), v.steps.map((s) => s.text)]);
    expect(pairs).toContainEqual(['multiply nine by nine', ['9*9']]);
    expect(pairs).toContainEqual(['add two and two', ['2+2', '3+3']]);
    expect(r.current.steps).toEqual([]);
  });

  it('switching focus moves the variation\'s portfolio records to the main operation', async () => {
    const r = await mount();
    await plan(r, 'add two and two');
    await plan(r, 'multiply nine by nine');
    const [v] = r.current.variations.variations;
    act(() => r.current.variations.switchTo(v.id));
    expect(r.current.steps.map((s) => s.text)).toEqual(['2+2', '3+3']);
    const own = r.current.knowledge.portfolios.filter((e) => e.actor === variationActor(v.id));
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((e) => e.source.operation === 'add two and two' && e.source.opId === null)).toBe(true);
    const [other] = r.current.variations.variations;
    expect(other.goal).toBe('multiply nine by nine');
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
    expect(r.current.variations.variations).toHaveLength(1);
    expect(r.current.variations.variations[0]).toMatchObject({ id: v.id, status: 'merged' });
    expect(r.current.steps.map((s) => s.text)).toEqual(['9*9', '2+2', '3+3']);
    act(() => r.current.variations.merge(v.id));
    expect(r.current.steps.map((s) => s.text)).toEqual(['9*9', '2+2', '3+3']);
  });

  it('each superseded goal keeps running as its own variation with its own portfolio actor; discard closes only one', async () => {
    const r = await mount();
    await plan(r, 'add two and two');
    await plan(r, 'multiply nine by nine');
    act(() => r.current.variations.startVariation());
    const list = r.current.variations.variations;
    expect(list.map((v) => [v.goal.toLowerCase(), v.status])).toEqual([['multiply nine by nine', 'running'], ['add two and two', 'running']]);
    const actors = new Set(r.current.knowledge.portfolios.map((e) => e.actor).filter((a) => a.startsWith('variation:')));
    expect(actors).toEqual(new Set(list.map((v) => variationActor(v.id))));
    const [first, second] = list;
    act(() => r.current.variations.discard(first.id));
    expect(r.current.variations.variations.map((v) => v.status)).toEqual(['discarded', 'running']);
    expect(r.current.variations.variations[1]).toBe(second);
    expect(r.current.knowledge.portfolios.some((e) => e.actor === variationActor(first.id))).toBe(false);
    expect(r.current.knowledge.portfolios.some((e) => e.actor === variationActor(second.id))).toBe(true);
  });
});
