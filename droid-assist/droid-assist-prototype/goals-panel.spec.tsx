import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { AssistEngine } from './use-assist.js';
import { createGoal, trace, DEFAULT_GOAL_STALL, type TraceContext } from './goal-tracer.js';
import { GoalsPanel } from './goals-panel.js';

const NOW = Date.now();
const ctx: TraceContext = { now: NOW, stallLimit: DEFAULT_GOAL_STALL };

const completedGoal = (() => {
  const created = createGoal({ goal: 'Export report', source: 'user', steps: [{ id: 's1', name: 'Open menu' }] }, NOW);
  const done = trace(created, { kind: 'step', stepId: 's1', name: 'Open menu', ok: true, executed: true, detail: '' }, ctx).record;
  return trace(done, { kind: 'run', runId: 'run_1', outcome: 'success', flowId: 'card_1' }, ctx).record;
})();

const failedGoal = (() => {
  const created = createGoal({ goal: 'Save document', source: 'ai', steps: [{ id: 's1', name: 'Click Save' }] }, NOW);
  const withObstacle = trace(created, { kind: 'deviation', cause: 'popup', text: 'popup covers Save' }, ctx).record;
  return trace(withObstacle, { kind: 'run', runId: 'run_2', outcome: 'failed', flowId: null }, ctx).record;
})();

const engine = (over: { goals?: typeof completedGoal[]; tracerStatus?: string } = {}) =>
  ({ goals: over.goals ?? [completedGoal, failedGoal], tracerStatus: over.tracerStatus ?? 'idle — no active goal' } as unknown as AssistEngine);

describe('GoalsPanel', () => {
  it('shows goal text, status, progress, obstacles, run ids and workflow id', () => {
    render(<GoalsPanel engine={engine()} />);
    const panel = screen.getByRole('region', { name: 'Goals' });
    expect(panel.textContent).toContain('Export report');
    expect(panel.textContent).toContain('completed');
    expect(panel.textContent).toContain('100%');
    expect(panel.textContent).toContain('run_1');
    expect(panel.textContent).toContain('card_1');
    expect(panel.textContent).toContain('Save document');
    expect(panel.textContent).toContain('popup covers Save');
    expect(panel.textContent).toContain('failed');
  });

  it('shows the placeholder text when there are no goals', () => {
    render(<GoalsPanel engine={engine({ goals: [] })} />);
    expect(screen.getByText('Each plan, loaded flow or run gets its own traced goal here.')).toBeTruthy();
  });

  it('keeps completed and failed goals both listed', () => {
    const { container } = render(<GoalsPanel engine={engine()} />);
    expect(within(container).getByLabelText('Goal Export report')).toBeTruthy();
    expect(within(container).getByLabelText('Goal Save document')).toBeTruthy();
  });
});
