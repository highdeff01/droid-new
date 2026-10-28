import { describe, expect, it, vi } from 'vitest';
import { accessPaths, fromSnip, reroute, targetRegion, toSnip, type RerouteDeps } from './reroute.js';
import type { Knowledge } from './cross-reference.js';
import type { Frame, Habit, WorkflowStep } from './types.js';

const fakeImage = (): ImageData => ({ width: 1, height: 1, data: new Uint8ClampedArray(4), colorSpace: 'srgb' } as ImageData);
const fakeFrame = (id: number): Frame => ({ id, time: id, url: `data:image/jpeg;base64,F${id}`, data: fakeImage(), srcW: 100, srcH: 100, source: 'screen' });
const step = (over: Partial<WorkflowStep> = {}): WorkflowStep => ({ id: 's1', name: 'Open settings', action: 'click', target: 'Settings gear', x: 0.5, y: 0.5, status: 'pending', ...over });
const habit = (over: Partial<Habit> = {}): Habit => ({ id: 'h1', target: 'Settings gear', context: '', attempts: 4, successes: 4, lastUsed: 0, lessons: [], pinned: false, anchor: { x: 0.9, y: 0.1, patch: [], size: 0, time: 0 }, ...over } as Habit);
const empty: Knowledge = { map: [], familiar: [], habits: [], patterns: [], failures: [], dossiers: [], memory: [], context: '' };
const knowledge: Knowledge = {
  ...empty,
  map: [{ id: 'm1', name: 'Settings gear', box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, mappedAt: 0 }],
  familiar: [{ id: 'f1', name: 'Settings', x: 0.6, y: 0.3, timesSeen: 3, lastSeen: 0 }],
  habits: [habit()],
};

const deps = (over: Partial<RerouteDeps> = {}): RerouteDeps => ({
  online: true,
  knowledge,
  snip: vi.fn(async () => fakeFrame(5)),
  identify: vi.fn(async () => null),
  replan: vi.fn(async () => null),
  ...over,
});

describe('accessPaths', () => {
  it('ranks mapped > learned > habit and skips the failed point', () => {
    expect(accessPaths('Settings gear', { x: 0.5, y: 0.5 }, knowledge)).toEqual([
      { source: 'mapped', name: 'Settings gear', x: 0.15000000000000002, y: 0.15000000000000002 },
      { source: 'learned', name: 'Settings', x: 0.6, y: 0.3 },
      { source: 'habit', name: 'Settings gear', x: 0.9, y: 0.1 },
    ]);
    expect(accessPaths('Settings gear', { x: 0.61, y: 0.3 }, knowledge).map((p) => p.source)).toEqual(['mapped', 'habit']);
  });
  it('drops unreliable habits and unrelated elements', () => {
    const k: Knowledge = { ...empty, familiar: [{ id: 'f', name: 'Trash', x: 0.2, y: 0.2, lastSeen: 0 }], habits: [habit({ attempts: 10, successes: 1 })] };
    expect(accessPaths('Settings gear', { x: 0.5, y: 0.5 }, k)).toEqual([]);
  });
});

describe('snip geometry', () => {
  it('maps a snip point back to the screen and forth', () => {
    const box = targetRegion(step());
    expect(box.w).toBeCloseTo(0.3);
    const p = { x: 0.25, y: 0.75 };
    const screen = fromSnip(box, p);
    expect(toSnip(box, screen).x).toBeCloseTo(p.x);
    expect(toSnip(box, screen).y).toBeCloseTo(p.y);
  });
});

describe('reroute — on failure', () => {
  it('re-identifies on a fresh snip of the target region first', async () => {
    const d = deps({ identify: vi.fn(async () => ({ x: 0.42, y: 0.58 })) });
    const out = await reroute(step({ refFrame: fakeFrame(1), correctedX: 0.51 }), 'grounding failed', d);
    expect(d.snip).toHaveBeenCalledWith(targetRegion(step({ correctedX: 0.51 })));
    expect(out.kind).toBe('resnip');
    expect(out.step).toMatchObject({ x: 0.42, y: 0.58, refFrame: undefined, correctedX: undefined });
    expect(out.snip?.id).toBe(5);
    expect(d.replan).not.toHaveBeenCalled();
  });

  it('takes the best alternate access path when the snip does not re-identify the target', async () => {
    const d = deps();
    const out = await reroute(step(), 'comparison failed', d);
    expect(out.kind).toBe('alternate');
    expect(out.step.x).toBeCloseTo(0.15);
    expect(out.text).toMatch(/mapped "Settings gear"/);
    expect(d.replan).not.toHaveBeenCalled();
  });

  it('re-plans when there is no fresh identification nor alternate path', async () => {
    const next = step({ action: 'double_click', x: 0.3, y: 0.7 });
    const d = deps({ knowledge: empty, replan: vi.fn(async () => next) });
    const out = await reroute(step(), 'comparison failed', d);
    expect(d.replan).toHaveBeenCalledWith(step(), 'comparison failed');
    expect(out).toMatchObject({ kind: 'replan', step: next });
  });

  it('never stops the run: a failing route counts as nothing and the step runs on as planned', async () => {
    const s = step();
    const d = deps({ knowledge: empty, snip: vi.fn(async () => { throw new Error('capture lost'); }), replan: vi.fn(async () => { throw new Error('endpoint down'); }) });
    const out = await reroute(s, 'grounding failed', d);
    expect(out).toMatchObject({ kind: 'none', step: s });
  });

  it('offline it uses only the alternate access paths', async () => {
    const d = deps({ online: false });
    const out = await reroute(step(), 'grounding failed', d);
    expect(d.snip).not.toHaveBeenCalled();
    expect(out.kind).toBe('alternate');
  });

  it('only re-plans a step with no on-screen target', async () => {
    const s = step({ action: 'type', text: 'hi' });
    const d = deps();
    expect((await reroute(s, 'failed', d)).kind).toBe('none');
    expect(d.snip).not.toHaveBeenCalled();
    expect(d.replan).toHaveBeenCalledTimes(1);
  });
});
