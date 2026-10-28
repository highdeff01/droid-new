import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject, transition } from './project.js';
import { EMPTY_APPROVALS, enqueue } from './approval-queue.js';
import { ProjectsPanel } from './projects-panel.js';
import type { AssistEngine } from './use-assist.js';
import type { ProjectEngine } from './use-projects.js';

function setup() {
  const live = createProject('Deck', 'Make a slide deck');
  const failed = transition(createProject('Script', 'Write a script'), 'failed', 'gave up');
  const { state } = enqueue(EMPTY_APPROVALS, live.id, [{ id: 's1', name: 'Type title', action: 'type', x: 0.1, y: 0.1, text: 'Hello' }]);
  const projects: ProjectEngine = {
    projects: [live, failed], approvals: state, running: null,
    add: vi.fn(), remove: vi.fn(), inject: vi.fn(), injectRunning: vi.fn(), research: vi.fn(async () => undefined), decideApproval: vi.fn(), resume: vi.fn(),
  };
  render(<ProjectsPanel engine={{ projects, armed: true } as unknown as AssistEngine} />);
  return { projects, live, failed, request: state.queue[0] };
}

describe('ProjectsPanel', () => {
  afterEach(cleanup);
  it('lists each project with its state, progress and next action', () => {
    setup();
    expect(screen.getByText('Deck')).toBeTruthy();
    expect(screen.getByText(/· working · turn 0 · no run yet/)).toBeTruthy();
    expect(screen.getByText(/Next: Plan the next steps/)).toBeTruthy();
    expect(screen.getByText(/Next: Resume to try again/)).toBeTruthy();
  });

  it('starts a project from the form and injects user info', () => {
    const { projects, live } = setup();
    fireEvent.change(screen.getByLabelText('Project goal'), { target: { value: 'Build a workflow' } });
    fireEvent.click(screen.getByText('Start project'));
    expect(projects.add).toHaveBeenCalledWith('', 'Build a workflow');
    fireEvent.change(screen.getByLabelText('Info for Deck'), { target: { value: 'use the red template' } });
    fireEvent.click(screen.getAllByText('Inject')[0]);
    expect(projects.inject).toHaveBeenCalledWith(live.id, 'user', 'you', 'use the red template');
  });

  it('approves, edits and rejects queued commands and resumes a failed project', () => {
    const { projects, failed, request } = setup();
    fireEvent.click(screen.getByText('Approve'));
    expect(projects.decideApproval).toHaveBeenCalledWith(request.id, { kind: 'approve' });
    fireEvent.change(screen.getByLabelText('Edit Type title'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByText('Save edit'));
    expect(projects.decideApproval).toHaveBeenCalledWith(request.id, { kind: 'edit', step: expect.objectContaining({ text: 'Hi' }) });
    fireEvent.click(screen.getByText('Reject'));
    expect(projects.decideApproval).toHaveBeenCalledWith(request.id, { kind: 'reject' });
    fireEvent.click(screen.getByText('Resume'));
    expect(projects.resume).toHaveBeenCalledWith(failed.id);
  });
});
