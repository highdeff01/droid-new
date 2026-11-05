import { describe, expect, it } from 'vitest';
import { CADENCE_AGENTS } from './agent-cadence.js';
import { activityReports, type ActivitySnapshot } from './agent-activity.js';
import type { WorkflowStep } from './types.js';

const step = (id: string, status: WorkflowStep['status']): WorkflowStep => ({ id, name: id, action: 'click', x: 0, y: 0, status });

const snapshot = (over: Partial<ActivitySnapshot> = {}): ActivitySnapshot => ({
  goal: 'Open the reports folder',
  steps: [step('a', 'done'), step('b', 'pending'), step('c', 'failed')],
  sync: { level: 'yellow', detail: 'Target moved 12px' },
  progress: { done: 1, manual: 0 },
  popup: null,
  watcher: { notes: [], proposals: [], tests: [] },
  familiar: 3,
  known: 2,
  supervisor: { status: 'reviewing', detail: 'Reviewing 3 step(s)', review: null, applied: false },
  crew: [{ id: 'agent-2', status: 'working', task: 'find Save', lastReport: null }],
  ops: [{ id: 'recheck', status: 'waiting', task: null, lastReport: 'intended effect seen' }],
  ...over,
});

const textOf = (id: string, snap = snapshot()) => activityReports(CADENCE_AGENTS.filter((a) => a.id === id), snap, 42)[0];

describe('activityReports', () => {
  it('gives every agent on the cadence a non-empty live report', () => {
    const reports = activityReports(CADENCE_AGENTS, snapshot(), 42);
    expect(reports).toHaveLength(CADENCE_AGENTS.length);
    expect(reports.every((r) => r.text.trim().length > 0 && r.time === 42)).toBe(true);
  });

  it('reports each role from its own state', () => {
    expect(textOf('drift').text).toBe('Sync yellow — Target moved 12px');
    expect(textOf('goal').text).toContain('1 done, 1 failed, 1 pending');
    expect(textOf('supervisor').text).toBe('reviewing — Reviewing 3 step(s)');
    expect(textOf('coords').text).toContain('3 familiar');
    expect(textOf('crew:agent-2').text).toBe('working on "find Save"');
    expect(textOf('ops:recheck').text).toContain('last report: intended effect seen');
  });

  it('names the flagged popup only in the popup watcher report', () => {
    const snap = snapshot({ popup: { id: 'p', x: 0, y: 0, w: 1, h: 1, label: 'Sale ad', tone: 'warn' } });
    expect(textOf('popup', snap).text).toContain('Sale ad');
    expect(textOf('drift', snap).text).not.toContain('Sale ad');
  });

  it('says an agent without a command is waiting', () => {
    expect(textOf('crew:agent-1').text).toBe('waiting for a command');
  });
});
