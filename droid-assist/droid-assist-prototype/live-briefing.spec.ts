import { describe, expect, it } from 'vitest';
import type { ActionRecord, Frame, LogEntry } from './types.js';
import type { ThinkingEntry } from './thinking-timeline.js';
import { MAIN_AI, PREFERRED_LIMIT, filterNotes, markPreferred, noteValues, notesStream, outcomeOf, recentActions, sectionOf } from './live-briefing.js';

const rec = (over: Partial<ActionRecord>): ActionRecord => ({ id: 'r', time: 0, action: 'click', x: 1, y: 1, source: 'Replay', via: 'bridge', ok: true, message: '', ...over });
const frame = (id: number) => ({ id, time: id, url: `data:${id}` }) as unknown as Frame;

describe('action outcomes', () => {
  it('labels each outcome', () => {
    expect(outcomeOf(rec({}))).toBe('ok');
    expect(outcomeOf(rec({ ok: false }))).toBe('failed');
    expect(outcomeOf(rec({ via: 'demo', ok: false }))).toBe('failed');
    expect(outcomeOf(rec({ via: 'demo' }))).toBe('simulated');
    expect(outcomeOf(rec({ via: 'demo', dryRun: true, simulated: true }))).toBe('simulated');
    expect(outcomeOf(rec({ dryRun: true }))).toBe('dry run');
    expect(outcomeOf(rec({ via: 'main-app', dryRun: true }))).toBe('dry run');
    expect(outcomeOf(rec({ via: 'main-app' }))).toBe('ok');
    expect(outcomeOf(rec({ dispatched: true, ok: false }))).toBe('dispatched');
  });

  it('orders the history most recent first', () => {
    const list = [rec({ id: 'a', time: 2 }), rec({ id: 'b', time: 9 }), rec({ id: 'c', time: 5 })];
    expect(recentActions(list).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('preferred shots', () => {
  it('keeps marked frames newest first, deduped by frame id and capped', () => {
    let list = markPreferred([], frame(1), MAIN_AI, 'big change', 1);
    list = markPreferred(list, frame(2), 'Supervisor', 'element', 2);
    list = markPreferred(list, frame(1), 'Coordinate learner', 'again', 3);
    expect(list.map((p) => [p.frame.id, p.by])).toEqual([[1, 'Coordinate learner'], [2, 'Supervisor']]);
    for (let i = 10; i < 30; i++) list = markPreferred(list, frame(i), MAIN_AI, 'x', i);
    expect(list).toHaveLength(PREFERRED_LIMIT);
    expect(list[0].frame.id).toBe(29);
  });
});

describe('notes stream', () => {
  const log: LogEntry[] = [
    { id: 'l1', time: 1, source: 'Planner', message: 'Planned 3 steps', tone: 'info', project: 'A' },
    { id: 'l2', time: 4, source: 'Supervisor', message: 'Applied a fix', tone: 'ok', project: 'B' },
    { id: 'l3', time: 5, source: 'Mystery', message: 'Something', tone: 'info' },
  ];
  const timeline: ThinkingEntry[] = [
    { id: 't1', time: 3, step: 'Open menu', kind: 'thought', text: 'Click File', thinking: null, project: 'A' },
    { id: 't2', time: 6, step: 'Save', kind: 'verdict', text: '', thinking: null, error: 'timeout' },
  ];
  const notes = notesStream(log, timeline);

  it('merges log and Qwen thinking entries newest first with time, agent, section and a link back', () => {
    expect(notes.map((n) => n.ref)).toEqual([
      { kind: 'thinking', id: 't2' }, { kind: 'log', id: 'l3' }, { kind: 'log', id: 'l2' }, { kind: 'thinking', id: 't1' }, { kind: 'log', id: 'l1' },
    ]);
    expect(notes[0]).toMatchObject({ time: 6, agent: MAIN_AI, section: 'thinking', project: '', text: 'Save — failed: timeout' });
    expect(notes[3]).toMatchObject({ agent: MAIN_AI, project: 'A', text: 'Open menu — Click File' });
    expect(notes[4]).toMatchObject({ agent: 'Planner', section: 'planning', project: 'A' });
    expect(sectionOf('Mystery')).toBe('system');
    expect(sectionOf('You')).toBe('user');
  });

  it('filters by project, agent and section combined, an unset filter matching all', () => {
    expect(filterNotes(notes, {})).toHaveLength(5);
    expect(filterNotes(notes, { project: 'A' }).map((n) => n.ref.id)).toEqual(['t1', 'l1']);
    expect(filterNotes(notes, { agent: MAIN_AI, project: 'A' }).map((n) => n.ref.id)).toEqual(['t1']);
    expect(filterNotes(notes, { section: 'agents' }).map((n) => n.ref.id)).toEqual(['l2']);
    expect(filterNotes(notes, { project: '' }).map((n) => n.ref.id)).toEqual(['t2', 'l3']);
    expect(noteValues(notes, 'agent')).toEqual([MAIN_AI, 'Mystery', 'Planner', 'Supervisor']);
  });
});
