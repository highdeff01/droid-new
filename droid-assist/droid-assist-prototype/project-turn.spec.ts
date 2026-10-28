import { describe, expect, it, vi } from 'vitest';
import type { GoalCheck } from './assist-ai.js';
import { createProject, injectInfo, type Project, type PlannedStep, type ProjectState } from './project.js';
import { runProjectTurn, type TurnDeps } from './project-turn.js';
import type { RunOutcome } from './triggers.js';

const step = (id: string, patch: Partial<PlannedStep> = {}): PlannedStep => ({ id, name: `Step ${id}`, action: 'click', x: 0.1, y: 0.1, ...patch });

/** A fresh set of vi.fn fakes: a passing plan/run/check with no approvals and no halt, as the common starting point. */
function baseDeps(): TurnDeps {
  return {
    halt: vi.fn(() => null),
    plan: vi.fn(async (): Promise<PlannedStep[]> => [step('s1')]),
    gate: vi.fn(),
    pending: vi.fn(() => 0),
    run: vi.fn(async (_p: Project, dryRun: boolean): Promise<RunOutcome> => ({ ok: 1, total: 1, dryRun, stopped: false })),
    check: vi.fn(async (): Promise<GoalCheck> => ({ complete: true, progress: true, reason: 'goal verified', thinking: '' })),
    maxRetries: 2,
    update: vi.fn(),
    refresh: (p: Project) => p,
  };
}

const visited = (deps: TurnDeps) => (deps.update as ReturnType<typeof vi.fn>).mock.calls.map((call) => (call[0] as Project).state);

describe('runProjectTurn', () => {
  it('happy path ends complete, visiting testing, replying, verifying, acting, follow-up in order', async () => {
    const deps = baseDeps();
    const result = await runProjectTurn(createProject('Deck', 'Make a slide deck'), deps);
    expect(result.state).toBe('complete');
    expect(visited(deps)).toEqual(['testing', 'replying', 'verifying', 'acting', 'follow-up', 'complete']);
  });

  it('pending approvals stop in waiting-for-reply, and a later turn with approvals cleared proceeds to testing', async () => {
    const deps = baseDeps();
    (deps.pending as ReturnType<typeof vi.fn>).mockReturnValueOnce(2);
    const afterFirst = await runProjectTurn(createProject('N', 'G'), deps);
    expect(afterFirst.state).toBe('waiting-for-reply');

    const deps2 = baseDeps();
    await runProjectTurn(afterFirst, deps2);
    expect(visited(deps2)[0]).toBe('testing');
  });

  it('a failed test goes retrying → correcting → retesting', async () => {
    const deps = baseDeps();
    let dryRunCalls = 0;
    (deps.run as ReturnType<typeof vi.fn>).mockImplementation(async (_p: Project, dryRun: boolean): Promise<RunOutcome> => {
      if (!dryRun) return { ok: 1, total: 1, dryRun, stopped: false };
      dryRunCalls += 1;
      return { ok: dryRunCalls === 1 ? 0 : 1, total: 1, dryRun, stopped: false };
    });
    await runProjectTurn(createProject('N', 'G'), deps);
    const seq = visited(deps);
    const at = (s: ProjectState) => seq.indexOf(s);
    expect(at('retrying')).toBeGreaterThan(-1);
    expect(at('correcting')).toBeGreaterThan(at('retrying'));
    expect(at('retesting')).toBeGreaterThan(at('correcting'));
  });

  it('a failing goal check gives working with turn incremented and injects the reason as main-ai', async () => {
    const deps = baseDeps();
    (deps.check as ReturnType<typeof vi.fn>).mockResolvedValue({ complete: false, progress: true, reason: 'still missing the summary slide', thinking: '' });
    const result = await runProjectTurn(createProject('N', 'G'), deps);
    expect(result.state).toBe('working');
    expect(result.turn).toBe(1);
    const pending = result.injections.filter((i) => i.consumedTurn === undefined);
    expect(pending).toEqual([expect.objectContaining({ source: 'main-ai', from: 'goal check', text: 'still missing the summary slide' })]);
  });

  it('exhausting retries then alternative methods ends in terminal failure', async () => {
    const deps = baseDeps();
    deps.maxRetries = 1;
    (deps.run as ReturnType<typeof vi.fn>).mockImplementation(async (_p: Project, dryRun: boolean): Promise<RunOutcome> => ({ ok: 0, total: 1, dryRun, stopped: false }));
    const result = await runProjectTurn(createProject('N', 'G'), deps);
    expect(result.state).toBe('failed');
    expect(result.completion).toMatchObject({ done: false, reason: expect.stringMatching(/Retries \(1\) and alternative methods \(2\) exhausted/) });
  });

  it('a halt reason puts the project on-hold, never failed, and the next turn restores it to working', async () => {
    const deps = baseDeps();
    (deps.halt as ReturnType<typeof vi.fn>).mockReturnValue('Kill-switch armed');
    const held = await runProjectTurn(createProject('N', 'G'), deps);
    expect(held.state).toBe('on-hold');
    expect(held.history[0]).toMatchObject({ to: 'on-hold', note: 'Kill-switch armed' });

    const deps2 = baseDeps();
    await runProjectTurn(held, deps2);
    expect(visited(deps2)[0]).toBe('working');
  });

  it('a throwing plan puts the project on-hold', async () => {
    const deps = baseDeps();
    (deps.plan as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('planner exploded'));
    const result = await runProjectTurn(createProject('N', 'G'), deps);
    expect(result.state).toBe('on-hold');
    expect(result.history[0].note).toBe('Stopped: planner exploded');
  });

  it('a run stopped by ■ Stop or the budget puts the project on hold after one run, never retried or failed', async () => {
    const deps = baseDeps();
    (deps.run as ReturnType<typeof vi.fn>).mockImplementation(async (_p: Project, dryRun: boolean): Promise<RunOutcome> => ({ ok: dryRun ? 1 : 0, total: 1, dryRun, stopped: !dryRun }));
    const result = await runProjectTurn(createProject('N', 'G'), deps);
    expect(result.state).toBe('on-hold');
    expect(result.history[0].note).toMatch(/^Run stopped/);
    expect(deps.run).toHaveBeenCalledTimes(2);
  });

  it('info injected while the turn ran keeps the goal check from completing and feeds the next turn', async () => {
    const deps = baseDeps();
    deps.refresh = (p) => injectInfo(p, { source: 'agent', from: 'Drift agent', text: 'also add slide 4' });
    const result = await runProjectTurn(createProject('N', 'G'), deps);
    expect(result.state).toBe('working');
    expect(result.injections.filter((i) => i.consumedTurn === undefined).map((i) => i.text)).toContain('also add slide 4');
  });

  it('injected info appears in the PlanRequest context of the next turn', async () => {
    const deps = baseDeps();
    const project = injectInfo(createProject('N', 'G'), { source: 'user', from: 'you', text: 'use the red template' });
    await runProjectTurn(project, deps);
    expect(deps.plan).toHaveBeenCalledWith(expect.objectContaining({ context: expect.arrayContaining([expect.stringContaining('use the red template')]) }));
  });
});
