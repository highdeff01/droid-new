import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AssistEngine } from './use-assist.js';
import type { OperationAttempt } from './current-operation.js';
import type { WorkflowStep } from './types.js';
import { CurrentOperationPanel } from './current-operation-panel.js';

const steps: WorkflowStep[] = [
  { id: 'b', name: 'Click files icon', target: 'files icon', action: 'click', x: 0.4, y: 0.5, status: 'running' },
  { id: 'c', name: 'Type name', target: 'name field', action: 'type', text: 'x', x: 0.6, y: 0.2, status: 'pending' },
];
const attempts: OperationAttempt[] = [
  { id: 'a1', stepId: 'b', name: 'Click files icon', action: 'click', actor: 'Replay', intent: 'Moving to files icon (40%, 50%) to click it because the files list is needed.', from: { x: 0.1, y: 0.1 }, to: { x: 0.4, y: 0.5 }, start: 100, end: 200, ok: false },
  { id: 'a2', stepId: 'b', name: 'Click files icon', action: 'click', actor: 'Replay', intent: 'Moving to files icon (40%, 50%) to click it because the files list is needed.', from: { x: 0.3, y: 0.4 }, to: { x: 0.42, y: 0.5 }, start: 250 },
];
const trail = [{ x: 0.2, y: 0.3, t: 150 }, { x: 0.3, y: 0.4, t: 190 }, { x: 0.4, y: 0.5, t: 260 }];

const engine = (over: Partial<Record<string, unknown>> = {}) =>
  ({ steps, activeIndex: 0, attempts, trail, activeGoal: null, goal: 'Rename the file', cursor: null, ...over } as unknown as AssistEngine);

describe('CurrentOperationPanel', () => {
  it('shows the operation, intention, main goal, attention, next step and both attempts with planned and actual paths', () => {
    const { container } = render(<CurrentOperationPanel engine={engine()} />);
    const panel = screen.getByRole('region', { name: 'Operation progress' });
    expect(panel.textContent).toContain('click "files icon"');
    expect(panel.textContent).toContain('because the files list is needed');
    expect(panel.textContent).toContain('Rename the file');
    expect(panel.textContent).toContain('42%, 50%');
    expect(panel.textContent).toContain('type "name field"');
    expect(panel.textContent).toContain('Attempt 2');
    expect(container.querySelectorAll('[data-kind="planned"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-kind="actual"]')).toHaveLength(2);
    expect(container.querySelector('[data-kind="attention"]')).toBeTruthy();
  });

  it('shows the idle placeholder when nothing ran', () => {
    render(<CurrentOperationPanel engine={engine({ steps: [], activeIndex: null, attempts: [], trail: [], goal: '' })} />);
    expect(screen.getByText('No operation running — the active step shows here.')).toBeTruthy();
  });
});
