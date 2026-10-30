import { describe, expect, it, vi } from 'vitest';
import { aimedStep, executeStep, locateAiFree, runAiFree, type AiFreeDeps } from './ai-free.js';
import { boxFrame as frameOf, boxImage as imageWith } from './test-frames.js';
import type { WorkflowStep } from './types.js';

const W = 320;
const H = 180;

/** A simulated screen: buttons that vanish when clicked within 6 sample px; it can be shifted to model drift. */
function screen(buttons: Array<{ x: number; y: number }>) {
  const state = { buttons: [...buttons], sends: [] as Array<{ x: number; y: number }> };
  let n = 0;
  const capture = vi.fn(async () => frameOf(imageWith(state.buttons), ++n));
  const send = vi.fn(async (step: WorkflowStep) => {
    const p = { x: (step.correctedX ?? step.x) * W, y: (step.correctedY ?? step.y) * H };
    state.sends.push({ x: step.correctedX ?? step.x, y: step.correctedY ?? step.y });
    state.buttons = state.buttons.filter((b) => Math.hypot(b.x - p.x, b.y - p.y) > 6);
    return { ok: true, message: 'completed' };
  });
  return { state, capture, send };
}

const step = (id: string, sx: number, sy: number, ref?: ImageData): WorkflowStep => ({
  id, name: `click ${id}`, action: 'click', x: sx / W, y: sy / H, target: id, status: 'pending', refFrame: ref ? frameOf(ref) : undefined,
});

const deps = (s: ReturnType<typeof screen>, extra: Partial<AiFreeDeps> = {}): AiFreeDeps => ({ capture: s.capture, send: s.send, log: () => undefined, ...extra });

describe('locateAiFree', () => {
  it('template-matches the reference frame and shifts the point by the measured drift', () => {
    const ref = imageWith([{ x: 100, y: 60 }]);
    const live = frameOf(imageWith([{ x: 112, y: 68 }]));
    const at = locateAiFree(step('a', 100, 60, ref), live);
    expect(at.source).toBe('template');
    expect(at.x * W).toBeCloseTo(112, 0);
    expect(at.y * H).toBeCloseTo(68, 0);
  });

  it('falls back to learned coordinates when the template is not found, then to the recorded point', () => {
    const ref = imageWith([{ x: 100, y: 60 }]);
    const live = frameOf(imageWith([]));
    const learned = () => ({ x: 0.7, y: 0.4 });
    expect(locateAiFree(step('a', 100, 60, ref), live, learned)).toMatchObject({ source: 'learned', x: 0.7, y: 0.4 });
    expect(locateAiFree(step('a', 100, 60, ref), live, () => null)).toMatchObject({ source: 'recorded', x: 100 / W, y: 60 / H });
    expect(locateAiFree(step('b', 50, 50), live)).toMatchObject({ source: 'recorded' });
  });
});

describe('aimedStep', () => {
  it('shifts a drag drop point by the same correction as its start', () => {
    const drag: WorkflowStep = { id: 'd', name: 'drag', action: 'drag', x: 0.2, y: 0.2, endX: 0.6, endY: 0.5, status: 'pending' };
    const aimed = aimedStep(drag, { x: 0.25, y: 0.3 });
    expect(aimed).toMatchObject({ correctedX: 0.25, correctedY: 0.3 });
    expect(aimed.endX).toBeCloseTo(0.65);
    expect(aimed.endY).toBeCloseTo(0.6);
  });
});

describe('runAiFree', () => {
  it('runs recorded steps with zero AI calls while every step verifies, dispatching at the drift-corrected point', async () => {
    const s = screen([{ x: 112, y: 68 }, { x: 212, y: 128 }]);
    const consultAi = vi.fn();
    const steps = [step('a', 100, 60, imageWith([{ x: 100, y: 60 }, { x: 200, y: 120 }])), step('b', 200, 120, imageWith([{ x: 200, y: 120 }]))];
    const run = await runAiFree(steps, deps(s, { consultAi }));
    expect(run.ok).toBe(true);
    expect(run.aiCalls).toBe(0);
    expect(consultAi).not.toHaveBeenCalled();
    expect(s.state.sends[0].x * W).toBeCloseTo(112, 0);
    expect(s.state.sends[0].y * H).toBeCloseTo(68, 0);
    expect(run.results.map((r) => r.source)).toEqual(['template', 'template']);
    expect(run.results[0].planned).toEqual({ x: 100 / W, y: 60 / H });
  });

  it('reports a verified learned point so the last-known-good coordinates follow the screen', async () => {
    const s = screen([{ x: 150, y: 90 }]);
    const onVerified = vi.fn();
    const run = await runAiFree([step('a', 40, 40)], deps(s, { learned: () => ({ x: 150 / W, y: 90 / H }), onVerified }));
    expect(run.results[0]).toMatchObject({ ok: true, source: 'learned' });
    expect(onVerified).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), expect.anything(), expect.objectContaining({ x: 150 / W }));
  });

  it('consults the AI exactly once for a step that fails verification and runs its correction AI-free', async () => {
    const s = screen([{ x: 250, y: 150 }]);
    const consultAi = vi.fn(async (st: WorkflowStep) => ({ ...st, x: 250 / W, y: 150 / H }));
    const run = await runAiFree([step('a', 40, 40)], deps(s, { consultAi }));
    expect(consultAi).toHaveBeenCalledTimes(1);
    expect(run.aiCalls).toBe(1);
    expect(run.results[0].ok).toBe(true);
  });

  it('keeps acting when the AI is down: the failed step is marked failed and the next step still runs', async () => {
    const s = screen([{ x: 200, y: 120 }]);
    const consultAi = vi.fn(async () => {
      throw new Error('quantumclaw unreachable');
    });
    const run = await runAiFree([step('a', 40, 40), step('b', 200, 120, imageWith([{ x: 200, y: 120 }]))], deps(s, { consultAi }));
    expect(run.results.map((r) => r.ok)).toEqual([false, true]);
    expect(run.results[0].message).toMatch(/AI unavailable: quantumclaw unreachable/);
    expect(run.aiCalls).toBe(1);
    expect(s.send).toHaveBeenCalledTimes(2);
  });

  it('runs with no AI at all and reports the failed step without throwing', async () => {
    const s = screen([]);
    const run = await runAiFree([step('a', 40, 40)], deps(s));
    expect(run).toMatchObject({ ok: false, aiCalls: 0 });
  });
});

describe('executeStep', () => {
  it('verifies against an expected after-frame when one is stored', async () => {
    const s = screen([{ x: 100, y: 60 }]);
    const expected = frameOf(imageWith([]));
    const out = await executeStep(step('a', 100, 60), deps(s, { expected: () => expected }));
    expect(out.ok).toBe(true);
    expect(out.message).toMatch(/matches the reference/);
  });

  it('fails without dispatch when there is no live frame', async () => {
    const s = screen([]);
    const out = await executeStep(step('a', 1, 1), deps(s, { capture: async () => Promise.reject(new Error('no capture')) }));
    expect(out).toMatchObject({ ok: false, executed: false, bridgeFailed: true });
    expect(s.send).not.toHaveBeenCalled();
  });
});
