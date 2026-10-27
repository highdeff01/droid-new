import { describe, expect, it } from 'vitest';
import { GOALS_KEY, currentObjective, dropGoal, loadGoals, nextGoals, queueGoal, runningProjects, saveGoals, settleGoal, startGoal } from './goal-tracer.js';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

describe('goal tracer', () => {
  it('traces a started goal as the active current objective, keyed by its trimmed text', () => {
    const goals = startGoal([], '  Export the report  ', 10);
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ text: 'Export the report', state: 'active', time: 10, updated: 10 });
    expect(currentObjective(goals)?.text).toBe('Export the report');
    expect(runningProjects(goals)).toEqual(['Export the report']);
  });

  it('ignores a blank goal', () => {
    expect(startGoal([], '   ')).toEqual([]);
    expect(queueGoal([], '')).toEqual([]);
  });

  it('settles a goal achieved or failed without duplicating its record', () => {
    let goals = startGoal([], 'Send mail', 1);
    goals = settleGoal(goals, 'Send mail', true, 5);
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ state: 'achieved', time: 1, updated: 5 });
    goals = settleGoal(startGoal(goals, 'Book flight', 6), 'Book flight', false, 7);
    expect(goals.find((g) => g.text === 'Book flight')?.state).toBe('failed');
    expect(currentObjective(goals)?.text).toBe('Book flight');
  });

  it('prefers an active goal over a more recently settled one', () => {
    let goals = startGoal([], 'A', 1);
    goals = settleGoal(startGoal(goals, 'B', 2), 'B', true, 3);
    expect(currentObjective(goals)?.text).toBe('A');
  });

  it('lists queued goals as next goals, oldest first, and keeps an existing goal state when re-queued', () => {
    let goals = queueGoal([], 'Second', 2);
    goals = queueGoal(goals, 'Third', 3);
    goals = startGoal(goals, 'First', 4);
    goals = queueGoal(goals, 'First', 5);
    expect(nextGoals(goals).map((g) => g.text)).toEqual(['Second', 'Third']);
    expect(goals.find((g) => g.text === 'First')?.state).toBe('active');
    expect(currentObjective(queueGoal([], 'Only queued'))).toBeNull();
    goals = startGoal(goals, 'Second', 6);
    expect(nextGoals(goals).map((g) => g.text)).toEqual(['Third']);
    expect(nextGoals(dropGoal(goals, nextGoals(goals)[0].id))).toEqual([]);
  });

  it('persists and reloads records, dropping invalid ones', () => {
    const store = memory();
    saveGoals(startGoal([], 'Persist me', 1), store);
    expect(loadGoals(store).map((g) => g.text)).toEqual(['Persist me']);
    store.data.set(GOALS_KEY, JSON.stringify([{ id: 'x', text: 'ok', state: 'bogus', time: 1, updated: 1 }, 'junk']));
    expect(loadGoals(store)).toEqual([]);
    store.data.set(GOALS_KEY, '{not json');
    expect(loadGoals(store)).toEqual([]);
  });
});
