import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AssistEngine } from './use-assist.js';
import type { OperationGroup } from './operation-memory.js';
import { OperationMemoryPanel } from './memory-panel.js';

const group: OperationGroup = {
  operation: 'Export the sales report',
  notes: [{ id: 'n1', time: 1, operation: 'Export the sales report', text: 'Use the File menu, not the toolbar' }],
  failures: [{ id: 'f1', time: 2, operation: 'Export the sales report', actor: 'Subagent 2', what: 'Step "Export" did not complete', steps: ['"Export" (click)'], targets: ['Export'], shots: ['data:image/jpeg;base64,QQ'] }],
  blacklist: [{ source: 'pattern', text: 'double clicking the export icon' }],
  successes: [{ id: 'r1', time: 3, session: 's', goal: 'export the sales report as pdf', attempted: 2, succeeded: 2, durationMs: 1000, outcome: 'success' }],
};

const engine = (operations: OperationGroup[]) => ({ operations, addOperationNote: vi.fn(), forgetMemory: vi.fn() }) as unknown as AssistEngine;

afterEach(cleanup);

describe('OperationMemoryPanel', () => {
  it('shows each operation with its notes, failures and screenshots, blacklist and successes', () => {
    render(<OperationMemoryPanel engine={engine([group])} />);
    const block = within(screen.getByRole('article', { name: 'Operation Export the sales report' }));
    expect(block.getByText('Use the File menu, not the toolbar')).toBeTruthy();
    expect(block.getByText('Step "Export" did not complete')).toBeTruthy();
    expect(block.getByAltText('Failure screenshot').getAttribute('src')).toBe('data:image/jpeg;base64,QQ');
    expect(block.getByText('- [learned avoid] double clicking the export icon')).toBeTruthy();
    expect(block.getByRole('list', { name: 'Successes for Export the sales report' }).textContent).toContain('export the sales report as pdf');
  });

  it('adds a note to the operation and forgets notes and failures', () => {
    const e = engine([group]);
    render(<OperationMemoryPanel engine={e} />);
    fireEvent.change(screen.getByLabelText('New note for Export the sales report'), { target: { value: 'Wait for the dialog' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(e.addOperationNote).toHaveBeenCalledWith('Export the sales report', 'Wait for the dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Forget note Use the File menu, not the toolbar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forget failure Step "Export" did not complete' }));
    expect(e.forgetMemory).toHaveBeenNthCalledWith(1, 'n1');
    expect(e.forgetMemory).toHaveBeenNthCalledWith(2, 'f1');
  });

  it('shows an empty state with no remembered operations', () => {
    render(<OperationMemoryPanel engine={engine([])} />);
    expect(screen.getByRole('region', { name: 'Operation memory' }).textContent).toContain('No operations remembered yet.');
  });
});
