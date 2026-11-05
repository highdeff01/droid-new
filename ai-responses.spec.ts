import { describe, expect, it } from 'vitest';
import type { LogEntry, WorkflowStep } from './types.js';
import type { ThinkingEntry } from './thinking-timeline.js';
import type { GoalRecord } from './goal-objectives.js';
import { aiResponses, currentActivity, filterResponses, linkedLog, sourceOf } from './ai-responses.js';

const entry = (id: string, time: number, over: Partial<ThinkingEntry> = {}): ThinkingEntry => ({ id, time, step: id, kind: 'thought', text: id, thinking: null, ...over });
const logAt = (id: string, time: number, project?: string): LogEntry => ({ id, time, source: 'Agent bus', message: id, tone: 'info', ...(project ? { project } : {}) });
const step = (name: string, status: WorkflowStep['status']) => ({ id: name, name, action: 'click', x: 0, y: 0, status }) as WorkflowStep;
const goal = (text: string, state: GoalRecord['state'], time: number): GoalRecord => ({ id: text, text, state, time, updated: time });

describe('sourceOf', () => {
  it('maps agent replies to agent, tests to test, checks to grounding and verdicts to verdict', () => {
    expect(sourceOf(entry('a', 0, { kind: 'reply' }))).toBe('agent');
    expect(sourceOf(entry('b', 0, { kind: 'test' }))).toBe('test');
    expect(sourceOf(entry('c', 0, { kind: 'check' }))).toBe('grounding');
    expect(sourceOf(entry('d', 0, { kind: 'verdict' }))).toBe('verdict');
    expect(sourceOf(entry('e', 0, { kind: 'proposal' }))).toBe('planner');
    expect(sourceOf(entry('f', 0, { kind: 'movement' }))).toBe('supervisor');
  });
});

describe('linkedLog', () => {
  it('links the closest log entry of the same project within the window', () => {
    const log = [logAt('far', 20_000, 'P'), logAt('other', 10_100, 'Q'), logAt('near', 10_300, 'P'), logAt('nearer', 9_900, 'P')];
    expect(linkedLog(entry('x', 10_000, { project: 'P' }), log)).toBe('nearer');
  });

  it('links nothing when no log entry is within the window', () => {
    expect(linkedLog(entry('x', 0), [logAt('late', 6_000)])).toBeNull();
  });
});

describe('aiResponses / filterResponses', () => {
  it('lists every entry newest first with its source and log link, filterable by source', () => {
    const timeline = [entry('old', 1_000, { kind: 'reply' }), entry('new', 3_000, { kind: 'test' })];
    const all = aiResponses(timeline, [logAt('l', 1_200)]);
    expect(all.map((r) => [r.entry.id, r.source, r.logId])).toEqual([['new', 'test', 'l'], ['old', 'agent', 'l']]);
    expect(filterResponses(all, 'agent').map((r) => r.entry.id)).toEqual(['old']);
    expect(filterResponses(all)).toHaveLength(2);
  });
});

describe('currentActivity', () => {
  it('names the running step and lists pending steps then queued goals as next', () => {
    const a = currentActivity([step('Open', 'done'), step('Click Save', 'running'), step('Confirm', 'pending')], [goal('Export', 'active', 1), goal('Mail it', 'pending', 2)]);
    expect(a).toEqual({ doing: 'Step 2: Click Save', next: ['Step: Confirm', 'Goal: Mail it'] });
  });

  it('falls back to the objective, then idle', () => {
    expect(currentActivity([], [goal('Export', 'active', 1)]).doing).toBe('Objective: Export');
    expect(currentActivity([], [])).toEqual({ doing: 'Idle', next: [] });
  });
});
