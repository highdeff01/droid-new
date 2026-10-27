import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AssistEngine } from './use-assist.js';
import type { ActionRecord, Frame, LogEntry } from './types.js';
import type { ThinkingEntry } from './thinking-timeline.js';
import type { GoalRecord } from './goal-tracer.js';
import type { UserNote } from './knowledge-store.js';
import { LiveBriefingPanel } from './live-briefing-panel.js';

afterEach(cleanup);

const goal = (text: string, state: GoalRecord['state'], time: number): GoalRecord => ({ id: `g-${text}`, text, state, time, updated: time });
const act = (id: string, time: number, over: Partial<ActionRecord>): ActionRecord => ({ id, time, action: 'click', x: 1, y: 1, source: 'Replay', via: 'bridge', ok: true, message: id, ...over });
const frame = (id: number) => ({ id, time: id, url: `data:image/png;base64,${id}` }) as unknown as Frame;
const log: LogEntry[] = [
  { id: 'l1', time: 1000, source: 'Planner', message: 'Planned two steps', tone: 'info', project: 'Export report' },
  { id: 'l2', time: 3000, source: 'Supervisor', message: 'Fixed the target', tone: 'ok', project: 'Other' },
];
const timeline: ThinkingEntry[] = [{ id: 't1', time: 2000, step: 'Open menu', kind: 'thought', text: 'Click File', thinking: null, project: 'Export report' }];

const engine = (over: Partial<AssistEngine> = {}) => ({
  goals: [goal('Export report', 'active', 5), goal('Send mail', 'pending', 6), goal('Print it', 'pending', 7)],
  history: [act('older', 1, { via: 'demo' }), act('newest', 9, { ok: false }), act('middle', 5, { dispatched: true })],
  preferred: [{ frame: frame(42), by: 'Main AI', reason: 'big change', time: 1 }],
  log, timeline,
  userNotes: [] as UserNote[],
  aiWorking: false,
  queueNextGoal: vi.fn(), removeGoal: vi.fn(), addNote: vi.fn(),
  ...over,
}) as unknown as AssistEngine;

describe('LiveBriefingPanel', () => {
  it('shows the current objective with its traced state and the next goals in order', () => {
    render(<LiveBriefingPanel engine={engine()} />);
    const panel = screen.getByRole('region', { name: 'Live briefing' });
    expect(panel.textContent).toContain('Export report · active');
    expect(within(screen.getByRole('list', { name: 'Next goals' })).getAllByRole('listitem').map((li) => li.textContent?.replace('✕', '').trim())).toEqual(['Send mail', 'Print it']);
  });

  it('queues a next goal and adds a user note for a chosen running project', () => {
    const e = engine();
    render(<LiveBriefingPanel engine={e} />);
    fireEvent.change(screen.getByLabelText('Next goal'), { target: { value: 'Archive' } });
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
    expect(e.queueNextGoal).toHaveBeenCalledWith('Archive');
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Use PDF' } });
    fireEvent.change(screen.getByLabelText('Note project'), { target: { value: 'Export report' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(e.addNote).toHaveBeenCalledWith('Use PDF', 'Export report');
  });

  it('lists previous actions most recent first with their outcomes', () => {
    render(<LiveBriefingPanel engine={engine()} />);
    const items = within(screen.getByLabelText('Previous actions')).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('b')?.textContent)).toEqual(['failed', 'dispatched', 'simulated']);
  });

  it('opens a preferred frame in the gallery, or says it is gone', () => {
    const e = engine();
    const { container, rerender } = render(<><LiveBriefingPanel engine={e} /><figure id="frame-42" /></>);
    const target = container.querySelector<HTMLElement>('#frame-42')!;
    fireEvent.click(screen.getByRole('button', { name: 'Open frame 42 in the gallery' }));
    expect(document.activeElement).toBe(target);
    rerender(<><LiveBriefingPanel engine={e} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Open frame 42 in the gallery' }));
    expect(screen.getByRole('status').textContent).toContain('Frame #42 is no longer in the gallery');
  });

  it('filters the notes stream and clicks through to the log and thinking entries', () => {
    const { container } = render(<><LiveBriefingPanel engine={engine()} /><li id="log-l1" /><li id="think-t1" /></>);
    const stream = screen.getByLabelText('Notes stream');
    expect(within(stream).getAllByRole('button').map((b) => b.querySelector('b')?.textContent)).toEqual(['Supervisor', 'Main AI', 'Planner']);
    fireEvent.change(screen.getByLabelText('Filter by project'), { target: { value: 'Export report' } });
    fireEvent.change(screen.getByLabelText('Filter by agent'), { target: { value: 'Main AI' } });
    const [thinking] = within(stream).getAllByRole('button');
    expect(within(stream).getAllByRole('button')).toHaveLength(1);
    fireEvent.click(thinking);
    expect(document.activeElement).toBe(container.querySelector('#think-t1'));
    fireEvent.change(screen.getByLabelText('Filter by agent'), { target: { value: '\u0000' } });
    fireEvent.change(screen.getByLabelText('Filter by section'), { target: { value: 'planning' } });
    fireEvent.click(within(stream).getByRole('button'));
    expect(document.activeElement).toBe(container.querySelector('#log-l1'));
  });

  it('shows empty states', () => {
    render(<LiveBriefingPanel engine={engine({ goals: [], history: [], preferred: [], log: [], timeline: [] })} />);
    expect(screen.getByText(/No objective yet/)).toBeTruthy();
    expect(screen.getByText('No actions performed yet.')).toBeTruthy();
    expect(screen.getByText('No notes match.')).toBeTruthy();
  });
});
