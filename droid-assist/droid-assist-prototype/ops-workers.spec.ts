import { describe, expect, it, vi } from 'vitest';
import { createOpsWorkers, type OpsDeps } from './ops-workers.js';
import { PLACEMENT_UNSUPPORTED, type TestCandidate } from './operations.js';
import type { StageId, StageMap } from './loop-control.js';
import type { DriftCorrection } from './drift.js';
import type { Frame, WorkflowStep } from './types.js';

/** A Frame with no real pixel data (fine wherever recheck is disabled or skipped). */
const simpleFrame = (id: number, url = `u${id}`): Frame => ({ id, time: id, url, data: {} as ImageData, srcW: 1920, srcH: 1080, source: 'demo' });

/** A Frame whose drift buffer is solid black: identical content each call, so recheck always sees no effect. */
let blackId = 0;
const blackFrame = (): Frame => {
  const width = 320;
  const height = 180;
  const data = { width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' } as ImageData;
  return { id: ++blackId, time: blackId, url: 'data:image/jpeg;base64,blk', data, srcW: 1920, srcH: 1080, source: 'demo' };
};

/** Fake OpsDeps with every field stubbed by vi.fn; `over` replaces what a test needs to control. */
function baseDeps(over: Partial<OpsDeps> = {}): OpsDeps {
  return {
    op: () => 'login flow',
    stageOn: () => true,
    halted: () => null,
    report: vi.fn(),
    lastChange: () => null,
    mapNames: () => [],
    log: () => [],
    candidates: () => [],
    test: vi.fn(async () => ({ ok: true, message: 'ok' })),
    armed: () => false,
    plan: vi.fn(async () => []),
    apply: vi.fn(async (step: WorkflowStep) => ({ ok: true, executed: true, message: 'applied', target: { x: step.x, y: step.y } })),
    capture: vi.fn(async () => null),
    store: vi.fn(),
    addEvidence: vi.fn(() => 'ev1'),
    markEvidence: vi.fn(),
    correct: vi.fn((): DriftCorrection => ({ level: 'yellow', x: 0.6, y: 0.4, dxPx: 5, dyPx: 5, driftPx: 7, regionDistance: 0.1, matchDistance: 0.1, widened: false })),
    replan: vi.fn(async () => null),
    retries: () => 1,
    stages: () => ({} as StageMap),
    running: () => [],
    toggle: vi.fn(),
    place: vi.fn(async () => ({ ok: true, supported: true, state: null, message: 'placed' })),
    lastApplied: { current: null },
    ...over,
  };
}

describe('createOpsWorkers', () => {
  it('refuses a command when its loop-control stage is unchecked', async () => {
    const deps = baseDeps({ stageOn: (id: StageId) => id !== 'opsMonitor' });
    const worker = createOpsWorkers(deps);
    const result = await worker('monitor', 'watch');
    expect(result).toEqual({ ok: false, found: 'Monitor agent is unchecked in Loop control — not run' });
  });

  it('apply dispatches via deps and records before/after evidence', async () => {
    const step: WorkflowStep = { id: 's1', name: 'Click Save', action: 'click', target: 'Save', x: 0.5, y: 0.5, status: 'pending' };
    const before = simpleFrame(1, 'before-url');
    const after = simpleFrame(2, 'after-url');
    const frames = [before, after];
    const deps = baseDeps({
      stageOn: (id: StageId) => id !== 'opsRecheck' && id !== 'opsPlacement',
      plan: vi.fn(async () => [step]),
      capture: vi.fn(async () => frames.shift() ?? after),
    });
    const worker = createOpsWorkers(deps);
    const result = await worker('apply', 'click save');
    expect(deps.apply).toHaveBeenCalledWith(step);
    expect(deps.store).toHaveBeenCalledWith(before);
    expect(deps.store).toHaveBeenCalledWith(after);
    expect(deps.addEvidence).toHaveBeenCalledWith({ op: 'login flow', step: 'Click Save', action: 'click', x: 0.5, y: 0.5, beforeId: 1, afterId: 2, before: 'before-url', after: 'after-url' });
    expect(result).toEqual({ ok: true, found: '"Click Save": applied (recheck disabled)', point: { x: 0.5, y: 0.5 } });
  });

  it('recheck fail -> reapply with corrected coords up to limit -> escalate', async () => {
    const step: WorkflowStep = { id: 's2', name: 'Click Next', action: 'click', target: 'Next', x: 0.5, y: 0.5, status: 'pending' };
    const deps = baseDeps({
      stageOn: (id: StageId) => id !== 'opsPlacement' && id !== 'opsScreenshots',
      plan: vi.fn(async () => [step]),
      capture: vi.fn(async () => blackFrame()),
      retries: () => 1,
    });
    const worker = createOpsWorkers(deps);
    const result = await worker('apply', 'click next');
    expect(deps.apply).toHaveBeenCalledTimes(2);
    expect(deps.correct).toHaveBeenCalledTimes(2);
    expect(deps.replan).toHaveBeenCalledWith(step, 'reapply limit (1) reached');
    expect(result.ok).toBe(false);
    expect(result.found).toContain('escalated to the main AI, no re-plan');
  });

  it('testing background first, foreground only when armed/needed', async () => {
    const candidate: TestCandidate = { name: 'Login button', x: 0.3, y: 0.4 };

    const disarmed = baseDeps({ candidates: () => [candidate], armed: () => false });
    const resultDisarmed = await createOpsWorkers(disarmed)('testing', 'test the Login button');
    expect(disarmed.test).toHaveBeenCalledTimes(1);
    expect(disarmed.test).toHaveBeenCalledWith(expect.objectContaining({ action: 'click', target: 'Login button' }), '', true);
    expect(resultDisarmed.found).toContain('real input disarmed — no foreground test');

    const armed = baseDeps({
      candidates: () => [candidate],
      armed: () => true,
      test: vi.fn(async (_step: WorkflowStep, _id: string, dryRun: boolean) => ({ ok: true, message: dryRun ? 'bg ok' : 'fg ok' })),
    });
    const resultArmed = await createOpsWorkers(armed)('testing', 'test the Login button');
    expect(armed.test).toHaveBeenCalledTimes(2);
    expect(armed.test).toHaveBeenNthCalledWith(1, expect.anything(), '', true);
    expect(armed.test).toHaveBeenNthCalledWith(2, expect.anything(), '', false);
    expect(resultArmed.found).toContain('foreground test of "Login button" passed');
  });

  it('automatic background-only tests never dispatch foreground input even while armed', async () => {
    const candidate: TestCandidate = { name: 'Save button', x: 0.4, y: 0.6 };
    const deps = baseDeps({ candidates: () => [candidate], armed: () => true });
    const result = await createOpsWorkers(deps)('testing', 'Background-only test "Save button"');
    expect(deps.test).toHaveBeenCalledTimes(1);
    expect(deps.test).toHaveBeenCalledWith(expect.objectContaining({ target: 'Save button' }), '', true);
    expect(result.found).toContain('no input dispatched');
  });

  it('placement unsupported message without api', async () => {
    const deps = baseDeps({ place: vi.fn(async () => ({ ok: false, supported: false, state: null, message: PLACEMENT_UNSUPPORTED })) });
    const worker = createOpsWorkers(deps);
    const result = await worker('placement', 'bring the app to front');
    expect(deps.place).toHaveBeenCalledWith('aside');
    expect(result).toEqual({ ok: false, found: PLACEMENT_UNSUPPORTED });
  });
});
