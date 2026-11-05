import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AssistEngine } from './use-assist.js';
import type { LogEntry, WorkflowStep } from './types.js';
import type { ThinkingEntry } from './thinking-timeline.js';
import { AiResponsesPanel } from './ai-responses-panel.js';

afterEach(cleanup);

const timeline: ThinkingEntry[] = [
  { id: 't1', time: 1_000, step: 'Popup watcher → "Close"', kind: 'reply', text: 'Supervisor: noted\nHabit system: learned', thinking: null },
  { id: 't2', time: 2_000, step: 'Side test "menu"', kind: 'test', text: 'passed', thinking: null },
  { id: 't3', time: 3_000, step: 'Open File', kind: 'check', text: 'PASS', thinking: 'Looks right', error: undefined },
];
const log: LogEntry[] = [{ id: 'l1', time: 1_100, source: 'Agent bus', message: 'forwarded', tone: 'info' }];
const steps = [{ id: 's1', name: 'Open File', action: 'click', x: 0, y: 0, status: 'running' }, { id: 's2', name: 'Save', action: 'click', x: 0, y: 0, status: 'pending' }] as WorkflowStep[];
const engine = { timeline, log, steps, objectives: [] } as unknown as AssistEngine;

describe('AiResponsesPanel', () => {
  it('shows every response with links to its thinking and log entries, and the current and next activity', () => {
    render(<AiResponsesPanel engine={engine} />);
    const panel = screen.getByRole('region', { name: 'AI responses' });
    expect(panel.textContent).toContain('Now: Step 1: Open File');
    expect(within(screen.getByRole('list', { name: 'Plans next' })).getByText('Step: Save')).toBeTruthy();
    const items = within(screen.getByRole('list', { name: 'Responses' })).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[2].textContent).toContain('Supervisor: noted');
    expect(within(items[2]).getByRole('link', { name: 'thinking entry' }).getAttribute('href')).toBe('#think-t1');
    expect(within(items[2]).getByRole('link', { name: 'log entry' }).getAttribute('href')).toBe('#log-l1');
  });

  it('filters by source', () => {
    render(<AiResponsesPanel engine={engine} />);
    fireEvent.change(screen.getByLabelText('Response source'), { target: { value: 'test' } });
    const items = within(screen.getByRole('list', { name: 'Responses' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([expect.stringContaining('Side test "menu"')]);
  });
});
