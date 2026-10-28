import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGES } from './loop-control.js';
import { CADENCE_AGENTS, REPORT_LIMIT, addReports, dueAgents, latestReports, reportContext, type AgentReport } from './agent-cadence.js';

const ids = (list: { id: string }[]) => list.map((a) => a.id);
const allAt = (t: number) => Object.fromEntries(CADENCE_AGENTS.map((a) => [a.id, t]));
const report = (agent: string, name: string, text: string, time: number): AgentReport => ({ agent, name, stage: 'drift', time, text });

describe('CADENCE_AGENTS', () => {
  it('covers every named agent role, each crew agent and each operations agent', () => {
    const list = ids([...CADENCE_AGENTS]);
    expect(list).toEqual(expect.arrayContaining(['popup', 'drift', 'progress', 'goal', 'screenWatcher', 'coords', 'supervisor', 'crew:agent-1', 'crew:agent-4', 'ops:monitor', 'ops:screenshots']));
    expect(new Set(list).size).toBe(list.length);
  });
});

describe('dueAgents', () => {
  it('makes every checked agent due at once before its first report', () => {
    expect(dueAgents(DEFAULT_STAGES, {}, 0, false)).toHaveLength(CADENCE_AGENTS.length);
  });

  it('reports every 5 s, and the goal reviewer and supervisor every 10 s', () => {
    const at = allAt(1000);
    expect(dueAgents(DEFAULT_STAGES, at, 5999, false)).toEqual([]);
    const at6 = ids(dueAgents(DEFAULT_STAGES, at, 6000, false));
    expect(at6).toContain('popup');
    expect(at6).toContain('ops:apply');
    expect(at6).not.toContain('goal');
    expect(at6).not.toContain('supervisor');
    expect(ids(dueAgents(DEFAULT_STAGES, at, 11_000, false))).toEqual(expect.arrayContaining(['goal', 'supervisor']));
  });

  it('doubles every period in relaxation mode', () => {
    const at = allAt(0);
    expect(dueAgents(DEFAULT_STAGES, at, 7000, true)).toEqual([]);
    expect(ids(dueAgents(DEFAULT_STAGES, at, 10_000, true))).toContain('drift');
    expect(ids(dueAgents(DEFAULT_STAGES, at, 10_000, true))).not.toContain('supervisor');
  });

  it('skips agents whose loop-control stage is unchecked', () => {
    const due = ids(dueAgents({ ...DEFAULT_STAGES, crew: false, opsRecheck: false, drift: false }, {}, 0, false));
    expect(due).not.toContain('drift');
    expect(due).not.toContain('ops:recheck');
    expect(due.some((id) => id.startsWith('crew:'))).toBe(false);
    expect(due).toContain('ops:apply');
  });
});

describe('reports', () => {
  it('keeps new reports first, capped', () => {
    const many = Array.from({ length: REPORT_LIMIT }, (_, i) => report('drift', 'Drift monitor', `r${i}`, i));
    const next = addReports(many, [report('goal', 'Goal reviewer', 'new', 999)]);
    expect(next).toHaveLength(REPORT_LIMIT);
    expect(next[0].text).toBe('new');
  });

  it('keeps the newest report per agent', () => {
    const list = [report('drift', 'Drift monitor', 'b', 2), report('goal', 'Goal reviewer', 'x', 1), report('drift', 'Drift monitor', 'a', 1)];
    expect(latestReports(list).map((r) => r.text)).toEqual(['b', 'x']);
  });

  it('sends every non-popup finding to the AI, popup findings stay quarantined', () => {
    const list = [report('popup', 'Popup watcher', 'No popup flagged', 3), report('drift', 'Drift monitor', 'Sync green', 2), report('ops:monitor', 'Monitor agent', 'No change', 1)];
    expect(reportContext(list)).toEqual(['[Drift monitor] Sync green', '[Monitor agent] No change']);
  });
});
