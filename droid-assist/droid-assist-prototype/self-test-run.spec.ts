import { describe, expect, it, vi } from 'vitest';
import type { WorkflowStep } from './types.js';
import { runSelfTest, selfTestText, type SelfTestDeps } from './self-test-run.js';

const play: WorkflowStep = { id: 'p', name: 'Click Play', action: 'click', target: 'Play', x: 0.5, y: 0.6, status: 'pending' };

function deps(over: Partial<SelfTestDeps> = {}): SelfTestDeps {
  return {
    goal: 'play the video',
    dryRun: true,
    plan: vi.fn(async () => ({ steps: [play], detail: 'AI plan' })),
    ground: vi.fn(async (s: WorkflowStep) => ({ ok: true, detail: 'confirmed', step: { ...s, x: 0.51 } })),
    execute: vi.fn(async () => ({ ok: true, detail: 'clicked' })),
    verify: vi.fn(async () => ({ ok: true, detail: 'video playing' })),
    stopped: () => null,
    ...over,
  };
}

describe('runSelfTest', () => {
  it('runs plan → ground → execute → verify and executes the grounded point', async () => {
    const d = deps();
    const r = await runSelfTest(d, 7);
    expect(r).toMatchObject({ goal: 'play the video', time: 7, dryRun: true, pass: true });
    expect(r.stages.map((s) => [s.stage, s.ok])).toEqual([['plan', true], ['ground', true], ['execute', true], ['verify', true]]);
    expect(d.execute).toHaveBeenCalledWith(expect.objectContaining({ x: 0.51 }));
    expect(d.verify).toHaveBeenCalledWith('play the video', [expect.objectContaining({ x: 0.51 })]);
    expect(selfTestText(r)).toMatch(/PASSED.*plan ok → ground ok → execute ok → verify ok/);
  });

  it('stops at an empty plan and fails', async () => {
    const d = deps({ plan: vi.fn(async () => ({ steps: [], detail: 'AI offline' })) });
    const r = await runSelfTest(d);
    expect(r.pass).toBe(false);
    expect(r.stages).toEqual([{ stage: 'plan', ok: false, detail: 'no step planned — AI offline' }]);
    expect(d.ground).not.toHaveBeenCalled();
  });

  it('reports a thrown stage as failed with its error and stops there', async () => {
    const d = deps({ verify: vi.fn(async () => { throw new Error('AI unreachable'); }) });
    const r = await runSelfTest(d);
    expect(r.stages[3]).toEqual({ stage: 'verify', ok: false, detail: 'AI unreachable' });
    expect(selfTestText(r)).toMatch(/FAILED.*AI unreachable/);
  });

  it('fails the next stage with the stop reason when aborted', async () => {
    let calls = 0;
    const r = await runSelfTest(deps({ stopped: () => (++calls > 2 ? 'Aborted' : null) }));
    expect(r.stages.map((s) => s.ok)).toEqual([true, true, false]);
    expect(r.stages[2]).toMatchObject({ stage: 'execute', detail: 'Aborted' });
  });

  it('fails grounding when a step is not found', async () => {
    const r = await runSelfTest(deps({ ground: vi.fn(async (s: WorkflowStep) => ({ ok: false, detail: 'not visible', step: s })) }));
    expect(r.stages[1]).toEqual({ stage: 'ground', ok: false, detail: '"Click Play": not visible' });
  });
});
