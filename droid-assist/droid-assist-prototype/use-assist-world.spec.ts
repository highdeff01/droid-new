import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useAssist } from './use-assist.js';
import { CHEST, WORLD_ICONS, WORLD_TOGGLE, initialWorld, itemPoint } from './test-world.js';
import { slotZone } from './test-world-items.js';

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const world = initialWorld();
const hero = world.characters.find((c) => c.name === 'Hero')!;
const pointOf = (name: string) => itemPoint(world, world.items.find((i) => i.spec.name === name)!)!;
const lastLog = (r: { current: ReturnType<typeof useAssist> }) => r.current.log.find((l) => l.source === 'You')?.message ?? '';

async function inWorld() {
  const { result } = renderHook(() => useAssist());
  await act(async () => {});
  act(() => result.current.onStageClick(WORLD_TOGGLE.x, WORLD_TOGGLE.y));
  return result;
}

describe('useAssist test world wiring', () => {
  it('switches scenes from the taskbar button', async () => {
    const result = await inWorld();
    expect(lastLog(result)).toMatch(/test World/);
    act(() => result.current.onStageClick(WORLD_TOGGLE.x, WORLD_TOGGLE.y));
    expect(lastLog(result)).toMatch(/Desktop/);
  });

  it('places the sword in the hand and rejects the hat there through stage drags', async () => {
    const result = await inWorld();
    act(() => result.current.onStageDrag(pointOf('Sword'), slotZone(hero, 'hand')));
    expect(lastLog(result)).toMatch(/Placed Sword in the hand of Hero — correct/);
    act(() => result.current.onStageDrag(pointOf('Hat'), slotZone(hero, 'hand')));
    expect(lastLog(result)).toMatch(/^Rejected/);
  });

  it('rejects opening the chest with nobody in reach and types into the calculator', async () => {
    const result = await inWorld();
    act(() => result.current.onStageDoubleClick(CHEST.x, CHEST.y));
    expect(lastLog(result)).toMatch(/Chest blocked/);
    const calc = WORLD_ICONS.find((i) => i.label === 'Calc')!;
    act(() => result.current.onStageDoubleClick(calc.x, calc.y));
    for (const key of ['7', '*', '6', 'Enter']) act(() => result.current.onStageKey({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }));
    expect(lastLog(result)).toMatch(/7\*6 = 42/);
  });
});
