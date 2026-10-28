import { afterEach, describe, expect, it, vi } from 'vitest';
import { SNIP_LIMIT, SNIP_MAX_PX, SNIP_USAGE, addSnip, clampBox, parseSnipArgs, snipFrame, snipSize, type Snip } from './snip.js';
import type { Frame } from './types.js';

const fakeImage = (): ImageData => ({ width: 1, height: 1, data: new Uint8ClampedArray(4), colorSpace: 'srgb' } as ImageData);
const frame = (id: number): Frame => ({ id, time: id, url: `data:image/jpeg;base64,F${id}`, data: fakeImage(), srcW: 100, srcH: 100, source: 'screen' });
const snip = (id: string): Snip => ({ id, time: 0, box: { x: 0, y: 0, w: 1, h: 1 }, frame: frame(1), by: 'ai', label: id, displayId: null });

describe('snipSize', () => {
  const box = { x: 0.25, y: 0.5, w: 0.5, h: 0.25 };
  it('uses the region native pixels when no size is given', () => {
    expect(snipSize(box, 1920, 1080)).toEqual({ w: 960, h: 270 });
  });
  it('is exact when both sides are given', () => {
    expect(snipSize(box, 1920, 1080, { w: 300, h: 300 })).toEqual({ w: 300, h: 300 });
  });
  it('keeps the region aspect when one side is given', () => {
    expect(snipSize(box, 1920, 1080, { w: 480 })).toEqual({ w: 480, h: 135 });
    expect(snipSize(box, 1920, 1080, { h: 540 })).toEqual({ w: 1920, h: 540 });
  });
  it('clamps each side to 1..SNIP_MAX_PX', () => {
    expect(snipSize(box, 1920, 1080, { w: 99999, h: 0.2 })).toEqual({ w: SNIP_MAX_PX, h: 1 });
  });
});

describe('clampBox', () => {
  it('keeps a region inside the screen', () => {
    expect(clampBox({ x: 0.8, y: -0.1, w: 0.5, h: 0.3 })).toEqual({ x: 0.8, y: 0, w: expect.closeTo(0.2), h: 0.3 });
  });
  it('is null for a region outside the screen', () => {
    expect(clampBox({ x: 1, y: 0, w: 0.2, h: 0.2 })).toBeNull();
  });
});

describe('parseSnipArgs', () => {
  it('parses a normalized region with no size or display', () => {
    expect(parseSnipArgs('0.1,0.2,0.3,0.4')).toEqual({ box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, size: {}, displayId: null });
  });
  it('reads values above 1 as percents, an output size and a display', () => {
    expect(parseSnipArgs('50, 0, 50, 50 800x600 display 2')).toEqual({ box: { x: 0.5, y: 0, w: 0.5, h: 0.5 }, size: { w: 800, h: 600 }, displayId: '2' });
  });
  it('takes one side of the output size', () => {
    expect(parseSnipArgs('0,0,1,1 x300')).toMatchObject({ size: { h: 300 } });
    expect(parseSnipArgs('0,0,1,1 640x')).toMatchObject({ size: { w: 640 } });
  });
  it('rejects malformed or empty regions with the usage', () => {
    expect(parseSnipArgs('files icon')).toEqual({ error: SNIP_USAGE });
    expect(parseSnipArgs('0,0,-1,1')).toEqual({ error: SNIP_USAGE });
    expect(parseSnipArgs('1,1,0.2,0.2')).toMatchObject({ error: expect.stringMatching(/empty/) });
  });
});

describe('addSnip', () => {
  it('keeps the newest first and at most SNIP_LIMIT', () => {
    let list: Snip[] = [];
    for (let i = 0; i < SNIP_LIMIT + 5; i++) list = addSnip(list, snip(`s${i}`));
    expect(list).toHaveLength(SNIP_LIMIT);
    expect(list[0].id).toBe(`s${SNIP_LIMIT + 4}`);
  });
});

describe('snipFrame — snip by region', () => {
  const drawImage = vi.fn();
  afterEach(() => vi.restoreAllMocks());

  it('crops the region from the full image at the requested size and maps back to native pixels', async () => {
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: () => Promise.resolve() });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 2000 });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { configurable: true, get: () => 1000 });
    const sizes: Array<[number, number]> = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      sizes.push([this.width, this.height]);
      return { drawImage, getImageData: () => fakeImage() } as unknown as CanvasRenderingContext2D;
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,SNIP');
    const live: Frame = { ...frame(1), full: 'data:image/jpeg;base64,FULL', srcW: 4000, srcH: 2000, originX: 1920, originY: 0 };
    const out = await snipFrame(live, { x: 0.5, y: 0.25, w: 0.25, h: 0.5 }, 7, { w: 500 });
    expect(sizes[0]).toEqual([500, 500]);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 1000, 250, 500, 500, 0, 0, 500, 500);
    expect(out).toMatchObject({ id: 7, url: 'data:image/jpeg;base64,SNIP', srcW: 1000, srcH: 1000, originX: 3920, originY: 500, source: 'screen' });
  });
});

describe('snip as a planner step', () => {
  it('is a step action the AI and agents can plan', async () => {
    const { STEP_ACTIONS } = await import('./types.js');
    const { PLAN_SYSTEM } = await import('./planner.js');
    expect(STEP_ACTIONS).toContain('snip');
    expect(PLAN_SYSTEM).toMatch(/"snip" sends no input/);
  });
});
