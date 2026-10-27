import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCrew, type CrewDeps } from './use-crew.js';
import type { ActionRecord, WorkflowStep } from './types.js';
import type { StepOutcome } from './run-step.js';
import type { ActionBudget } from './safety.js';

const rec = (id: string, x: number, prev: number): ActionRecord => ({ id, time: 0, action: 'move', x, y: x, prevX: prev, prevY: prev, srcW: 1000, srcH: 1000, source: 'Replay', via: 'bridge', ok: true, message: 'ok' });

function deps(over: Partial<CrewDeps> = {}): CrewDeps {
  return {
    crewSize: 10, goal: '', steps: [], history: [], addLog: vi.fn(),
    performStep: vi.fn(async (s: WorkflowStep): Promise<StepOutcome> => ({ ok: true, executed: false, message: 'dry', target: { x: s.x, y: s.y } })),
    newBudget: () => ({}) as ActionBudget, isArmed: () => false, hasFrames: () => true,
    knowledge: () => ({ map: [], familiar: [], habits: [], patterns: [], context: '' }), stopRun: vi.fn(), sendResult: vi.fn(),
    ...over,
  };
}

describe('useCrew backtrack', () => {
  it('moves back along the last N steps even when the newest is a pointer move', async () => {
    const d = deps({ history: [rec('c', 300, 200), rec('b', 200, 100)] });
    const { result } = renderHook(() => useCrew(d));
    await act(() => result.current.backtrack(2));
    const calls = vi.mocked(d.performStep).mock.calls.map(([s]) => [s.action, s.x, s.y]);
    expect(calls).toEqual([['move', 0.2, 0.2], ['move', 0.1, 0.1]]);
    expect(result.current.notices[0].text).toMatch(/Backtracked 2\/2/);
  });
});

describe('useCrew runTest', () => {
  it('sends the result back through the bus to the requester', async () => {
    const d = deps({ steps: [{ id: 's', name: 'Play', target: 'Play', action: 'click', x: 0.4, y: 0.6, status: 'failed' }] });
    const { result } = renderHook(() => useCrew(d));
    await act(async () => {
      await result.current.runTest({ from: 'drift', reason: 'off-path', text: 'off path' });
    });
    expect(d.sendResult).toHaveBeenCalledWith('drift', expect.objectContaining({ name: 'Play' }), expect.stringContaining('Test for drift'));
  });
});
