import { describe, expect, it, vi } from 'vitest';
import { SHOT_BATCH, buildWorkflow, parsePlacements, parseWorkflow, shotBatches, type BuilderDeps } from './workflow-builder.js';
import { boxFrame, boxImage } from './test-frames.js';
import type { AiReply, AskRequest } from './ai.js';
import type { WorkflowStep } from './types.js';

const shots = Array.from({ length: 23 }, (_, i) => boxFrame(boxImage([]), i + 1));
const WORKFLOW = JSON.stringify({ steps: [
  { name: 'Open Files', action: 'click', target: 'Files icon', x: 0.05, y: 0.1 },
  { name: 'Open Report', action: 'double_click', target: 'Report', x: 0.9, y: 0.2 },
  { name: 'Close', action: 'key', text: 'esc', x: 0.5, y: 0.5 },
] });

/** An AI that extracts WORKFLOW and answers each batch with `perBatch[n]`. */
function ai(perBatch: Array<{ placements: Array<{ shot: number; step: number }>; verified: number[] }>) {
  const calls: AskRequest[] = [];
  const ask = vi.fn(async (req: AskRequest): Promise<AiReply> => {
    calls.push(req);
    if (!req.frames) return { content: WORKFLOW, thinking: null };
    return { content: JSON.stringify(perBatch[calls.filter((c) => c.frames).length - 1] ?? { placements: [], verified: [] }), thinking: null };
  });
  return { ask, calls };
}

function deps(ask: BuilderDeps['ask'], events: string[] = []): BuilderDeps {
  return { ask, perform: vi.fn(async (s: WorkflowStep) => (events.push(`perform ${s.name}`), true)), log: () => undefined };
}

describe('buildWorkflow', () => {
  it('extracts the command into a workflow and analyses 23 screenshots in batches of 10, 10 and 3', async () => {
    const { ask, calls } = ai([]);
    const out = await buildWorkflow('open the report', shots, deps(ask));
    expect(out.steps.map((s) => s.name)).toEqual(['Open Files', 'Open Report', 'Close']);
    expect(out.batches).toEqual([10, 10, 3]);
    expect(calls.filter((c) => c.frames).map((c) => c.frames!.map((f) => f.id)[0])).toEqual([1, 11, 21]);
    expect(calls[0].prompt).toBe('open the report');
  });

  it('places each screenshot into its step and performs a step only after it is verified complete, in order', async () => {
    const events: string[] = [];
    const { ask } = ai([
      { placements: [{ shot: 0, step: 1 }, { shot: 4, step: 2 }], verified: [2] },
      { placements: [{ shot: 12, step: 1 }], verified: [1] },
      { placements: [{ shot: 22, step: 3 }], verified: [] },
    ]);
    const d = deps(ask, events);
    const out = await buildWorkflow('open the report', shots, d);
    expect(out.placements).toEqual([{ shot: 0, step: 0 }, { shot: 4, step: 1 }, { shot: 12, step: 0 }, { shot: 22, step: 2 }]);
    expect(out.verified).toEqual([0, 1]);
    expect(out.performed).toEqual([0, 1]);
    expect(events).toEqual(['perform Open Files', 'perform Open Report']);
  });

  it('executes nothing while the AI is unavailable', async () => {
    const d = deps(null);
    const out = await buildWorkflow('open the report', shots, d);
    expect(out.skipped).toMatch(/AI unavailable/);
    expect(d.perform).not.toHaveBeenCalled();
  });

  it('executes nothing when the AI fails to extract the workflow', async () => {
    const d = deps(async () => Promise.reject(new Error('offline')));
    const out = await buildWorkflow('x', shots, d);
    expect(out.skipped).toMatch(/offline/);
    expect(d.perform).not.toHaveBeenCalled();
  });

  it('stops performing after a step fails', async () => {
    const { ask } = ai([{ placements: [], verified: [1, 2, 3] }]);
    const d: BuilderDeps = { ask, perform: vi.fn(async () => false), log: () => undefined };
    const out = await buildWorkflow('x', shots, d);
    expect(d.perform).toHaveBeenCalledTimes(1);
    expect(out.performed).toEqual([]);
    expect(out.batches).toEqual([10]);
  });
});

describe('parsing', () => {
  it('drops workflow entries without a known action and clamps coordinates', () => {
    const steps = parseWorkflow('{"steps":[{"name":"a","action":"fly"},{"name":"b","action":"click","x":7,"y":-1}]}');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ name: 'b', x: 1, y: 0, status: 'pending' });
  });

  it('keeps only placements inside the batch and steps that exist', () => {
    expect(parsePlacements('{"placements":[{"shot":9,"step":1},{"shot":10,"step":1},{"shot":12,"step":9}],"verified":[1,4]}', 10, 10, 3)).toEqual({ placements: [{ shot: 10, step: 0 }], verified: [0] });
  });

  it('splits shots into batches of SHOT_BATCH', () => {
    expect(SHOT_BATCH).toBe(10);
    expect(shotBatches([1, 2, 3, 4, 5], 2).map((b) => b.first)).toEqual([0, 2, 4]);
  });
});
