import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoalCheck } from './assist-ai.js';
import { useGoalTracer, type GoalTracerDeps } from './use-goal-tracer.js';
import { createGoal } from './goal-tracer.js';

const GOALS_KEY = 'droid-assist.goals';
const STEPS = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
const stepDone = { kind: 'step', stepId: 'a', name: 'A', ok: true, executed: true, detail: '' } as const;

function setup(overrides: Partial<GoalTracerDeps> = {}) {
  const notify = vi.fn();
  const deps: GoalTracerDeps = { enabled: () => true, stallLimit: () => 2, notify, ...overrides };
  const hook = renderHook(() => useGoalTracer(deps));
  return { ...hook, notify, deps };
}

afterEach(() => {
  localStorage.clear();
});

describe('useGoalTracer', () => {
  it('hydrates a stored active goal as paused and leaves a completed goal unchanged', () => {
    const activeGoal = createGoal({ goal: 'old active', source: 'user', steps: STEPS });
    const completedGoal = { ...createGoal({ goal: 'old done', source: 'user', steps: STEPS }), status: 'completed' as const };
    localStorage.setItem(GOALS_KEY, JSON.stringify([activeGoal, completedGoal]));
    const { result } = setup();
    expect(result.current.goals.find((g) => g.id === activeGoal.id)?.status).toBe('paused');
    expect(result.current.goals.find((g) => g.id === completedGoal.id)?.status).toBe('completed');
  });

  it('pauses the previous active goal when a new one begins, and persists both', () => {
    const { result } = setup();
    act(() => result.current.tracer.begin({ goal: 'open notepad', source: 'user', steps: STEPS }));
    const firstId = result.current.goals[0].id;
    act(() => result.current.tracer.begin({ goal: 'open calc', source: 'user', steps: STEPS }));
    expect(result.current.goals).toHaveLength(2);
    expect(result.current.goals[0].status).toBe('active');
    expect(result.current.goals[1].id).toBe(firstId);
    expect(result.current.goals[1].status).toBe('paused');
    const stored = JSON.parse(localStorage.getItem(GOALS_KEY) ?? '[]');
    expect(stored).toHaveLength(2);
  });

  it('traces a step event only into the current goal and notifies of its completion', () => {
    const { result, notify } = setup();
    act(() => result.current.tracer.begin({ goal: 'open notepad', source: 'user', steps: STEPS }));
    act(() => result.current.tracer.begin({ goal: 'open calc', source: 'user', steps: STEPS }));
    const pausedId = result.current.goals[1].id;
    act(() => result.current.tracer.emit(stepDone));
    expect(result.current.goals[0].progress).toBe(50);
    expect(result.current.goals.find((g) => g.id === pausedId)?.progress).toBe(0);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('done'), expect.anything());
  });

  it('reports traced progress growth on a goal check', () => {
    const { result } = setup();
    act(() => result.current.tracer.begin({ goal: 'open notepad', source: 'user', steps: STEPS }));
    act(() => result.current.tracer.emit(stepDone));
    const check: GoalCheck = { complete: false, progress: false, reason: 'r', thinking: null };
    let judged: GoalCheck | undefined;
    act(() => {
      judged = result.current.tracer.check(check);
    });
    expect(judged?.progress).toBe(true);
  });

  it('does nothing while disabled', () => {
    const { result, notify } = setup({ enabled: () => false });
    act(() => result.current.tracer.begin({ goal: 'open notepad', source: 'user', steps: STEPS }));
    act(() => result.current.tracer.emit(stepDone));
    expect(result.current.goals).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('lists a finished goal in memory lines', () => {
    const finished = { ...createGoal({ goal: 'notepad cleanup', source: 'user', steps: STEPS }), status: 'completed' as const };
    localStorage.setItem(GOALS_KEY, JSON.stringify([finished]));
    const { result } = setup();
    const lines = result.current.tracer.memory('notepad');
    expect(lines.some((l) => l.startsWith('Recent goal:'))).toBe(true);
  });

  it('pauses the active goal on release and ignores further emits', () => {
    const { result } = setup();
    act(() => result.current.tracer.begin({ goal: 'open notepad', source: 'user', steps: STEPS }));
    act(() => result.current.tracer.release());
    expect(result.current.goals[0].status).toBe('paused');
    act(() => result.current.tracer.emit(stepDone));
    expect(result.current.goals[0].progress).toBe(0);
  });
});
