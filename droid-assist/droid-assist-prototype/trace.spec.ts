import { describe, expect, it, vi } from 'vitest';
import { TraceImportError, exportTrace, importTrace, newTrace, recordStep, replayTrace, type ReplayDeps, type Trace } from './trace.js';
import { executeStep } from './ai-free.js';
import { boxFrame, boxImage } from './test-frames.js';
import type { Frame, WorkflowStep } from './types.js';
import type { StoredFrame } from './frame-codec.js';

const W = 320;
const H = 180;

/** A simulated screen whose buttons vanish when clicked; every captured frame is kept for the decoder. */
function screen(buttons: Array<{ x: number; y: number }>) {
  const state = { buttons: [...buttons], sends: [] as Array<{ x: number; y: number }>, frames: new Map<string, Frame>() };
  let n = 0;
  const capture = async () => {
    const f = boxFrame(boxImage(state.buttons), ++n);
    state.frames.set(f.url, f);
    return f;
  };
  const send = vi.fn(async (step: WorkflowStep) => {
    const p = { x: step.correctedX ?? step.x, y: step.correctedY ?? step.y };
    state.sends.push(p);
    state.buttons = state.buttons.filter((b) => Math.hypot(b.x - p.x * W, b.y - p.y * H) > 6);
    return { ok: true, message: 'completed' };
  });
  const decode = async (s: StoredFrame) => state.frames.get(s.url) ?? null;
  return { state, capture, send, decode };
}

const click = (id: string, sx: number, sy: number): WorkflowStep => ({ id, name: `click ${id}`, action: 'click', x: sx / W, y: sy / H, target: id, status: 'pending' });

async function recorded(s: ReturnType<typeof screen>, steps: WorkflowStep[]): Promise<Trace> {
  let trace = newTrace('press both buttons', 1000);
  let t = 0;
  for (const step of steps) trace = recordStep(trace, step, await executeStep(step, { capture: s.capture, send: s.send, now: () => (t += 5), log: () => undefined }));
  return trace;
}

describe('trace recording', () => {
  it('records every real action with before/after frames, planned vs actual coordinates, verdict and timing', async () => {
    const s = screen([{ x: 100, y: 60 }, { x: 200, y: 120 }]);
    const trace = await recorded(s, [click('a', 100, 60), click('b', 30, 30)]);
    expect(trace.steps).toHaveLength(2);
    const [a, b] = trace.steps;
    expect(a).toMatchObject({ verdict: 'verified', planned: { x: 100 / W, y: 60 / H }, actual: { x: 100 / W, y: 60 / H }, ms: 5 });
    expect(a.beforeFrame.data).toBeDefined();
    expect(a.afterFrame?.data).toBeDefined();
    expect(a.beforeFrame.id).not.toBe(a.afterFrame?.id);
    expect(b.verdict).toBe('failed');
    expect(a.step.refFrame).toBeUndefined();
  });
});

describe('exportTrace / importTrace', () => {
  it('round-trips a trace through a file deep-equal', async () => {
    const s = screen([{ x: 100, y: 60 }, { x: 200, y: 120 }]);
    const trace = await recorded(s, [click('a', 100, 60), click('b', 200, 120)]);
    const text = exportTrace(trace);
    expect(text).not.toContain('"data"');
    expect(await importTrace(text, s.decode)).toEqual(trace);
  });

  it('rejects a file whose step lacks its before frame and names the step', async () => {
    const s = screen([{ x: 100, y: 60 }]);
    const file = JSON.parse(exportTrace(await recorded(s, [click('a', 100, 60)])));
    delete file.steps[0].beforeFrame;
    await expect(importTrace(JSON.stringify(file), s.decode)).rejects.toThrow(new TraceImportError('step 1: missing its before frame (the replay template)'));
  });

  it('flags a step whose after frame is missing as unverifiable', async () => {
    const s = screen([{ x: 100, y: 60 }]);
    const file = JSON.parse(exportTrace(await recorded(s, [click('a', 100, 60)])));
    delete file.steps[0].afterFrame;
    const back = await importTrace(JSON.stringify(file), s.decode);
    expect(back.steps[0].verdict).toBe('unverifiable');
    expect(back.steps[0].afterFrame).toBeUndefined();
  });

  it('rejects text that is not a trace file', async () => {
    await expect(importTrace('nope', async () => null)).rejects.toThrow(/not JSON/);
    await expect(importTrace('{"format":9,"steps":[]}', async () => null)).rejects.toThrow(/unsupported trace format/);
  });
});

describe('replayTrace', () => {
  const replayDeps = (s: ReturnType<typeof screen>, extra: Partial<ReplayDeps> = {}): ReplayDeps => ({
    capture: s.capture, send: s.send, retries: 2, stopped: () => null, replan: async () => null, log: () => undefined, ...extra,
  });

  it('re-executes with real dispatches at the drift-corrected point and verifies each step against its traced after frame', async () => {
    const rec = screen([{ x: 100, y: 60 }, { x: 200, y: 120 }]);
    const trace = await recorded(rec, [click('a', 100, 60), click('b', 200, 120)]);
    const live = screen([{ x: 112, y: 68 }, { x: 212, y: 128 }]);
    const result = await replayTrace(trace, replayDeps(live));
    expect(result.ok).toBe(true);
    expect(live.send).toHaveBeenCalledTimes(2);
    expect(live.state.sends[0].x * W).toBeCloseTo(112, 0);
    expect(live.state.sends[0].y * H).toBeCloseTo(68, 0);
    expect(result.steps.map((st) => st.out.source)).toEqual(['template', 'template']);
    expect(result.trace.steps.map((st) => st.verdict)).toEqual(['verified', 'verified']);
  });

  it('climbs the retry ladder in order — first, retries, re-plan — for a step that fails verification', async () => {
    const rec = screen([{ x: 100, y: 60 }]);
    const trace = await recorded(rec, [click('a', 100, 60)]);
    const live = screen([]);
    const replan = vi.fn(async () => null);
    const result = await replayTrace(trace, replayDeps(live, { replan }));
    expect(result.ok).toBe(false);
    expect(result.steps[0].attempts.map((a) => a.kind)).toEqual(['first', 'retry', 'retry']);
    expect(replan).toHaveBeenCalledTimes(1);
  });

  it('stops the replay when a guardrail halts the ladder', async () => {
    const rec = screen([{ x: 100, y: 60 }, { x: 200, y: 120 }]);
    const trace = await recorded(rec, [click('a', 100, 60), click('b', 200, 120)]);
    const result = await replayTrace(trace, replayDeps(screen([]), { stopped: () => 'aborted' }));
    expect(result.steps).toHaveLength(1);
    expect(result.ok).toBe(false);
  });
});
