import { describe, expect, it, vi } from 'vitest';
import type { AskFn } from './ai.js';
import type { Frame } from './types.js';
import type { ParallelSpec } from './wake-decision.js';
import {
  contextTick,
  distanceOn,
  startContext,
  stopContext,
  stopReason,
  tooFar,
} from './context-workflow.js';

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

let nextId = 1;
const mkFrame = (srcW = 1920, srcH = 1080): Frame => ({
  id: nextId++,
  time: Date.now(),
  url: 'data:,',
  data: new ImageData(new Uint8ClampedArray(320 * 180 * 4), 320, 180),
  srcW,
  srcH,
  source: 'demo',
});

describe('distanceOn', () => {
  it('is the horizontal fraction difference when the points share y', () => {
    const d = distanceOn({ name: 'a', x: 0.1, y: 0.5 }, { name: 'b', x: 0.4, y: 0.5 }, mkFrame(1920, 1080));
    expect(d).toBeCloseTo(0.3);
  });

  it('scales vertical distance by srcH/srcW', () => {
    const d = distanceOn({ name: 'a', x: 0.5, y: 0.1 }, { name: 'b', x: 0.5, y: 0.5 }, mkFrame(1920, 1080));
    expect(d).toBeCloseTo(0.4 * (1080 / 1920));
  });
});

describe('contextTick', () => {
  const spec = (subjectX: number, anchorX: number, maxDistance: number): ParallelSpec => ({
    goal: 'keep girl near guy',
    subject: { name: 'girl', x: subjectX, y: 0.5 },
    anchor: { name: 'guy', x: anchorX, y: 0.5 },
    maxDistance,
  });

  it('does not ask and gives a null move when the subject is within range on an unchanged frame', async () => {
    const frame = mkFrame();
    const wf = startContext(spec(0.45, 0.5, 0.2), frame, 'ai', 'goal');
    const ask = vi.fn<AskFn>();
    const result = await contextTick(wf, frame, ask);
    expect(ask).not.toHaveBeenCalled();
    expect(result.move).toBeNull();
  });

  it('asks once with a prompt naming both subject and anchor when the subject is too far', async () => {
    const frame = mkFrame();
    const wf = startContext(spec(0.1, 0.6, 0.2), frame, 'ai', 'goal');
    const ask = vi.fn<AskFn>(async () => ({
      content: JSON.stringify({ action: 'drag', x: 0.1, y: 0.5, endX: 0.55, endY: 0.5, why: 'bring her closer' }),
      thinking: null,
    }));
    const result = await contextTick(wf, frame, ask);
    expect(ask).toHaveBeenCalledTimes(1);
    const prompt = ask.mock.calls[0][0].prompt;
    expect(prompt).toContain('girl');
    expect(prompt).toContain('guy');
    expect(result.move?.step).toMatchObject({ action: 'drag', target: 'girl', endX: 0.55 });
  });

  it('gives a null step when the AI chooses no action', async () => {
    const frame = mkFrame();
    const wf = startContext(spec(0.1, 0.6, 0.2), frame, 'ai', 'goal');
    const ask = vi.fn<AskFn>(async () => ({ content: JSON.stringify({ action: 'none', why: 'blocked' }), thinking: null }));
    const result = await contextTick(wf, frame, ask);
    expect(result.move?.step).toBeNull();
  });
});

describe('startContext', () => {
  it('starts running with zero moves, the parent goal recorded and the distance computed', () => {
    const frame = mkFrame();
    const spec: ParallelSpec = { goal: 'keep close', subject: { name: 'girl', x: 0.1, y: 0.5 }, anchor: { name: 'guy', x: 0.4, y: 0.5 }, maxDistance: 0.2 };
    const wf = startContext(spec, frame, 'ai', 'main goal');
    expect(wf.running).toBe(true);
    expect(wf.moves).toBe(0);
    expect(wf.parentGoal).toBe('main goal');
    expect(wf.distance).toBeCloseTo(distanceOn(spec.subject, spec.anchor, frame));
  });
});

describe('stopReason', () => {
  const wf = startContext({ goal: 'keep close', subject: { name: 'girl', x: 0.1, y: 0.5 }, anchor: { name: 'guy', x: 0.4, y: 0.5 }, maxDistance: 0.2 }, mkFrame(), 'ai', 'main goal');

  it('is abort when aborted is true', () => {
    expect(stopReason(wf, 'main goal', true)).toBe('abort');
  });

  it('is goal when the current goal differs', () => {
    expect(stopReason(wf, 'different goal', false)).toBe('goal');
  });

  it('is null when the goal matches (whitespace-trimmed) and it was not aborted', () => {
    expect(stopReason(wf, '  main goal  ', false)).toBeNull();
  });
});

describe('stopContext', () => {
  it('stops running and records why', () => {
    const wf = startContext({ goal: 'keep close', subject: { name: 'girl', x: 0.1, y: 0.5 }, anchor: { name: 'guy', x: 0.4, y: 0.5 }, maxDistance: 0.2 }, mkFrame(), 'ai', 'main goal');
    const stopped = stopContext(wf, 'goal');
    expect(stopped.running).toBe(false);
    expect(stopped.stopped).toBe('goal');
  });
});

describe('tooFar', () => {
  it('is true only when distance exceeds maxDistance', () => {
    const frame = mkFrame();
    const near = startContext({ goal: 'g', subject: { name: 'a', x: 0.1, y: 0.5 }, anchor: { name: 'b', x: 0.2, y: 0.5 }, maxDistance: 0.2 }, frame, 'ai', 'g');
    const far = startContext({ goal: 'g', subject: { name: 'a', x: 0.1, y: 0.5 }, anchor: { name: 'b', x: 0.6, y: 0.5 }, maxDistance: 0.2 }, frame, 'ai', 'g');
    expect(tooFar(near)).toBe(false);
    expect(tooFar(far)).toBe(true);
  });
});
