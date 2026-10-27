import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { AssistEngine } from './use-assist.js';
import type { RunSummary } from './run-stats.js';
import type { SavedCard, WorkflowStep } from './types.js';
import { StatsPanel } from './stats-panel.js';

const step = (name: string): WorkflowStep => ({ id: name, name, action: 'click', x: 0.5, y: 0.5, status: 'pending' });
const run = (n: number, outcome: RunSummary['outcome'], flowId?: string): RunSummary => ({
  id: `r${n}`, time: Date.now() - n * 1000, session: 's', goal: 'g', attempted: 2, succeeded: 2, durationMs: 3000, outcome, ...(flowId ? { flowId } : {}),
});
const card: SavedCard = { id: 'c1', name: 'Open report', description: '', steps: [step('Open menu')], savedAt: 0 };

const engine = (over: Partial<AssistEngine> = {}) => ({
  runs: [run(1, 'success', 'c1'), run(2, 'failed', 'c1')],
  habits: [{ id: 'h', target: 'Save button', context: 'Word', attempts: 4, successes: 1, lastUsed: 0, lessons: [], pinned: false }],
  log: [{ id: 'l1', time: 1, source: 'Replay', message: 'Open menu: target not found', tone: 'error' as const }, { id: 'l2', time: 2, source: 'Replay', message: 'Bridge unreachable: refused', tone: 'error' as const }],
  cards: [card],
  steps: [],
  ...over,
}) as unknown as AssistEngine;

describe('StatsPanel', () => {
  it('shows totals, streak, failed targets and steps, and per-flow performance', () => {
    render(<StatsPanel engine={engine()} />);
    const panel = screen.getByRole('region', { name: 'Stats' });
    expect(panel.textContent).toContain('2 run(s) · 50% success');
    expect(panel.textContent).toContain('1 successful run(s) in a row');
    expect(panel.textContent).toContain('Save button');
    expect(panel.textContent).toContain('3 failed of 4');
    expect(panel.textContent).toContain('Open menu');
    expect(panel.textContent).not.toContain('Bridge unreachable');
    const row = within(screen.getByRole('table')).getByText('Open report').closest('tr')!;
    expect(Array.from(row.querySelectorAll('td')).map((td) => td.textContent)).toEqual(['Open report', '2', '1', '2.0', '3.0 s']);
  });

  it('shows empty states when nothing has run', () => {
    render(<StatsPanel engine={engine({ runs: [], habits: [], log: [], cards: [] })} />);
    expect(screen.getByText('No runs recorded yet.')).toBeTruthy();
    expect(screen.getByText('No failed targets in the habits.')).toBeTruthy();
    expect(screen.getByText('No failed steps in the run log.')).toBeTruthy();
  });
});
