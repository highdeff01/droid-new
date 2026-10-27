import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AssistEngine } from './use-assist.js';
import type { OperationRecord } from './operation-db.js';
import { DatabasePanel } from './database-panel.js';

const rec = (id: string, time: number, over: Partial<OperationRecord> = {}): OperationRecord => ({
  id, time, project: 'Invoice flow', agent: 'Replay', section: 'executor', category: 'track', op: 'click', element: 'Save button', input: 'click "Save button"', output: 'Clicked', ok: true, ...over,
});

const operations = [
  rec('a', 1000),
  rec('b', 2000, { category: 'error', op: 'bridge', errorKind: 'bridge', element: undefined, input: 'export', output: 'Bridge refused', ok: false, agent: 'Errors', section: 'bridge' }),
  rec('c', 3000, { category: 'capture', op: 'source', element: undefined, input: 'desktop', output: 'switched to desktop', project: 'Report', agent: 'Screen', section: 'capture' }),
];

const engine = (over: Partial<AssistEngine> = {}) => ({
  dbOperations: operations,
  exportOperations: vi.fn(() => 0),
  clearOperations: vi.fn(),
  ...over,
}) as unknown as AssistEngine;

const items = () => screen.getByRole('region', { name: 'Database' }).querySelectorAll('li');

describe('DatabasePanel', () => {
  afterEach(cleanup);
  it('lists every operation newest first with its input, output and scope', () => {
    render(<DatabasePanel engine={engine()} />);
    expect(screen.getByRole('region', { name: 'Database' }).textContent).toContain('3 of 3 operation(s)');
    expect(items()[0].textContent).toContain('capture/source');
    expect(items()[2].textContent).toContain('"Save button" click "Save button" → Clicked');
    expect(items()[2].textContent).toContain('Invoice flow · Replay · executor');
  });

  it('filters by search text, project, category and error kind', () => {
    render(<DatabasePanel engine={engine()} />);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'refused' } });
    expect(items()).toHaveLength(1);
    fireEvent.click(screen.getByText('Reset filters'));
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'report' } });
    expect(items()[0].textContent).toContain('switched to desktop');
    fireEvent.click(screen.getByText('Reset filters'));
    fireEvent.change(screen.getByLabelText('Error kind'), { target: { value: 'bridge' } });
    expect(items()[0].textContent).toContain('error/bridge');
    fireEvent.change(screen.getByLabelText('Error kind'), { target: { value: 'drift' } });
    expect(screen.getByText('No operations match.')).toBeTruthy();
  });

  it('exports the current filter and clears the database', () => {
    const e = engine();
    render(<DatabasePanel engine={e} />);
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'track' } });
    fireEvent.click(screen.getByText('Export JSON'));
    expect(e.exportOperations).toHaveBeenCalledWith({ category: 'track' });
    fireEvent.click(screen.getByText('Clear'));
    expect(e.clearOperations).toHaveBeenCalled();
  });

  it('disables export and clear when the database is empty', () => {
    render(<DatabasePanel engine={engine({ dbOperations: [] })} />);
    expect((screen.getByText('Export JSON') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Clear') as HTMLButtonElement).disabled).toBe(true);
  });
});
