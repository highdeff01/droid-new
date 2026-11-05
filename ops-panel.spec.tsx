import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AssistEngine } from './use-assist.js';
import { OPS_AGENTS } from './operations.js';
import { OperationsPanel } from './ops-panel.js';

const stages = Object.fromEntries(OPS_AGENTS.map((a) => [a.stage, true])) as Record<string, boolean>;

const waitingAgents = () => OPS_AGENTS.map((a) => ({ id: a.id, status: 'waiting' as const, task: null, lastReport: null }));

const engine = (over: Record<string, unknown> = {}) =>
  ({
    ops: { agents: waitingAgents(), reports: [], evidence: [] },
    opsRunning: false,
    settings: { stages },
    toggleStage: vi.fn(),
    stopPlan: vi.fn(),
    ...over,
  }) as unknown as AssistEngine;

afterEach(cleanup);

describe('OperationsPanel', () => {
  it('shows a row for each Operations agent with its status, task and last report', () => {
    const agents = waitingAgents().map((a) => (a.id === 'apply' ? { ...a, status: 'working' as const, task: 'click Save', lastReport: 'clicked at (0.5, 0.5)' } : a));
    render(<OperationsPanel engine={engine({ ops: { agents, reports: [], evidence: [] } })} />);
    const list = within(screen.getByRole('list', { name: 'Operations agent status' }));
    for (const def of OPS_AGENTS) expect(list.getByLabelText(def.name)).toBeTruthy();
    const applyRow = list.getByLabelText('Apply agent').closest('li')!;
    expect(applyRow.textContent).toContain('working');
    expect(applyRow.textContent).toContain('click Save');
    expect(applyRow.textContent).toContain('clicked at (0.5, 0.5)');
  });

  it('shows disabled instead of a status when the agent stage is unchecked', () => {
    render(<OperationsPanel engine={engine({ settings: { stages: { ...stages, opsMonitor: false } } })} />);
    const row = screen.getByLabelText('Monitor agent').closest('li')!;
    expect(row.textContent).toContain('disabled');
  });

  it('calls engine.toggleStage with the stage id and the new checked value on checkbox click', () => {
    const e = engine();
    render(<OperationsPanel engine={e} />);
    fireEvent.click(screen.getByLabelText('Monitor agent'));
    expect(e.toggleStage).toHaveBeenCalledWith('opsMonitor', false);
  });

  it('shows the evidence trail with before and after screenshots', () => {
    const evidence = [{ id: 'ev1', time: 1, op: 'Export', step: 'Export', action: 'click' as const, x: 0.5, y: 0.5, beforeId: 1, afterId: 2, before: 'data:image/jpeg;base64,BB', after: 'data:image/jpeg;base64,AA', verdict: 'effect' as const }];
    render(<OperationsPanel engine={engine({ ops: { agents: waitingAgents(), reports: [], evidence } })} />);
    fireEvent.click(screen.getByText('Evidence trail'));
    const trail = within(screen.getByRole('list', { name: 'Evidence trail' }));
    expect(trail.getByAltText('Before Export').getAttribute('src')).toBe('data:image/jpeg;base64,BB');
    expect(trail.getByAltText('After Export').getAttribute('src')).toBe('data:image/jpeg;base64,AA');
  });

  it('lists each agent\'s last report inline on its row', () => {
    const agents = waitingAgents().map((a) => (a.id === 'logging' ? { ...a, lastReport: '3 entries tagged "Export"' } : a));
    render(<OperationsPanel engine={engine({ ops: { agents, reports: [{ id: 'r1' }], evidence: [] } })} />);
    const row = screen.getByLabelText('Logging agent').closest('li')!;
    expect(row.textContent).toContain('3 entries tagged "Export"');
  });
});
