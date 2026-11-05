import { describe, expect, it } from 'vitest';
import type { Frame, Habit, LearnedPattern, WorkflowStep } from './types.js';
import type { RunSummary } from './run-stats.js';
import {
  BLACKLIST_LIMIT, EMPTY_MEMORY, FAILURE_SHOTS, addFailure, addNote, blacklistFor, failureFromRun, forget, isFailureRecord, isOperationNote,
  memoryBlock, newFailure, operationGroups, similarFailures, type MemorySources,
} from './operation-memory.js';
import { failurePattern } from './flow-memory.js';

const shot = (n: number) => `data:image/jpeg;base64,${n}`;
const frame = (n: number) => ({ url: shot(n) }) as Frame;

const step = (name: string, status: WorkflowStep['status'], extra: Partial<WorkflowStep> = {}): WorkflowStep => ({ id: name, name, action: 'click', x: 0.5, y: 0.5, status, ...extra });

const pattern = (kind: LearnedPattern['kind'], text: string, context: string): LearnedPattern => ({ id: text, kind, pattern: text, context, time: 1 });

const habit = (target: string, avoid: string): Habit => ({ id: target, target, context: '', attempts: 3, successes: 1, lastUsed: 1, pinned: false, lessons: [{ kind: 'avoid', text: avoid, time: 1 }, { kind: 'add', text: 'hover first', time: 1 }] });

const failure = (operation: string, steps: string[], targets: string[] = []) => newFailure({ operation, actor: 'Replay', what: 'did not complete', steps, targets, shots: [shot(1)] }, 1000);

const sources = (over: Partial<MemorySources> = {}): MemorySources => ({ patterns: [], habits: [], memory: EMPTY_MEMORY, ...over });

const run = (goal: string, outcome: RunSummary['outcome'], time = 1): RunSummary => ({ id: `${goal}-${outcome}`, time, session: 's', goal, attempted: 2, succeeded: 2, durationMs: 10, outcome });

describe('failureFromRun', () => {
  it('records the unfinished steps, their targets and the screenshots taken at them', () => {
    const steps = [step('Open mail', 'done'), step('Click send', 'failed', { target: 'Send button', shot: frame(7) }), step('Confirm', 'pending')];
    const f = failureFromRun('Send the invoice email', 'Replay', steps, frame(9), 5);
    expect(f.operation).toBe('Send the invoice email');
    expect(f.actor).toBe('Replay');
    expect(f.time).toBe(5);
    expect(f.steps).toEqual(['"Click send" (click on Send button)', '"Confirm" (click)']);
    expect(f.targets).toEqual(['Send button', 'Confirm']);
    expect(f.shots).toEqual([shot(7)]);
    expect(f.what).toContain('Click send');
  });

  it('falls back to the live screenshot when no step has one, and keeps at most FAILURE_SHOTS', () => {
    expect(failureFromRun('Op', 'Replay', [step('A', 'failed')], frame(3)).shots).toEqual([shot(3)]);
    expect(failureFromRun('Op', 'Replay', [], null).what).toBe('The run did not complete');
    const many = newFailure({ operation: 'Op', actor: 'x', what: 'w', steps: [], targets: [], shots: [1, 2, 3, 4, 5].map(shot) });
    expect(many.shots).toHaveLength(FAILURE_SHOTS);
    expect(many.shots.at(-1)).toBe(shot(5));
  });
});

describe('blacklistFor', () => {
  it('collects avoid patterns of the same kind of operation, habit avoid lessons of its targets and failed steps of similar failures', () => {
    const src = sources({
      patterns: [pattern('avoid', 'Do not double click the invoice row', 'send invoice email'), pattern('avoid', 'Never resize the chart', 'export quarterly chart'), pattern('add', 'Wait for the composer', 'send invoice email')],
      habits: [habit('Send button', 'clicking the greyed Send button'), habit('Chart legend', 'dragging the legend')],
      memory: addFailure(EMPTY_MEMORY, failure('Send invoice email to the client', ['"Attach PDF" (drag)'], ['Attach area'])),
    });
    const texts = blacklistFor('send invoice email', ['Send button'], src).map((e) => `${e.source}:${e.text}${e.on ? ` (on "${e.on}")` : ''}`);
    expect(texts).toContain('pattern:Do not double click the invoice row');
    expect(texts).toContain('habit:clicking the greyed Send button (on "Send button")');
    expect(texts).toContain('failure:"Attach PDF" (drag) failed in "Send invoice email to the client"');
    expect(texts.join('\n')).not.toMatch(/resize the chart|legend|Wait for the composer|hover first/);
  });

  it('includes habits on targets its similar failures failed on, dedupes and caps at BLACKLIST_LIMIT', () => {
    const memory = addFailure(EMPTY_MEMORY, failure('Upload the report', ['x'], ['Upload zone']));
    const src = sources({ memory, habits: [habit('Upload zone', 'dropping before it highlights')], patterns: Array.from({ length: 20 }, (_, i) => pattern('avoid', `bad ${i}`, '')).concat(pattern('avoid', 'BAD 0', '')) });
    const list = blacklistFor('upload report', [], src);
    expect(list).toHaveLength(BLACKLIST_LIMIT);
    expect(list.filter((e) => e.text.toLowerCase() === 'bad 0')).toHaveLength(1);
    expect(blacklistFor('upload report', [], sources({ memory, habits: [habit('Upload zone', 'dropping before it highlights')] })).map((e) => e.source)).toContain('habit');
  });

  it('keeps pattern and habit avoids when similar failures alone exceed BLACKLIST_LIMIT', () => {
    const memory = Array.from({ length: 20 }, (_, i) => failure(`send email ${i}`, [`"Step ${i}" (click)`], ['Send'])).reduce(addFailure, EMPTY_MEMORY);
    const src = sources({ memory, patterns: [pattern('avoid', 'never use ctrl+enter', 'send email')], habits: [habit('Send', 'clicking before the address resolves')] });
    const list = blacklistFor('send email', [], src);
    expect(list).toHaveLength(BLACKLIST_LIMIT);
    expect(list.map((e) => e.source)).toEqual(expect.arrayContaining(['failure', 'pattern', 'habit']));
  });

  it('dedupes the same lesson learned as a pattern and as a habit lesson', () => {
    const src = sources({ patterns: [pattern('avoid', 'click twice', '')], habits: [habit('Send', 'Click twice')] });
    expect(blacklistFor('send mail', ['Send'], src).filter((e) => e.text.toLowerCase() === 'click twice')).toHaveLength(1);
  });

  it("does not list a failed run twice: its automatic avoid pattern yields to the failure reminder", () => {
    const steps = [step('Click Send', 'failed', { target: 'Send button' })];
    const memory = addFailure(EMPTY_MEMORY, failureFromRun('send email to bob', 'Replay', steps, null, 1));
    const list = blacklistFor('send email to bob', [], sources({ memory, patterns: [failurePattern('send email to bob', steps)] }));
    expect(list.map((e) => e.source)).toEqual(['failure']);
    expect(blacklistFor('send email to bob', [], sources({ patterns: [failurePattern('send email to bob', steps)] })).map((e) => e.source)).toEqual(['pattern']);
  });

  it('keeps a failed-run pattern whose step no kept failure reminder lists', () => {
    const send = [step('Click Send', 'failed', { target: 'Send button' })];
    const body = [step('Type body', 'failed')];
    const memory = addFailure(EMPTY_MEMORY, failureFromRun('send email to bob', 'Replay', send, null, 1));
    const list = blacklistFor('send email to bob', [], sources({ memory, patterns: [failurePattern('send email to bob', body), failurePattern('send email to bob', send)] }));
    expect(list.map((e) => e.source).sort()).toEqual(['failure', 'pattern']);
    expect(list.find((e) => e.source === 'pattern')?.text).toContain('"Type body"');
  });

  it('is empty for an empty operation with no targets', () => {
    expect(blacklistFor('  ', [], sources({ patterns: [pattern('avoid', 'x', '')] }))).toEqual([]);
  });
});

describe('memoryBlock (injected into every AI turn)', () => {
  it('carries the goal, the objective, notes, the BLACKLISTED methods, similar failures and recent activity', () => {
    const memory = addNote(addFailure(EMPTY_MEMORY, failure('Archive old newsletters', ['"Archive" (click)'])), 'archive newsletters', 'Use the bulk select checkbox');
    const block = memoryBlock(
      { operation: 'Archive the newsletters', objective: '"Select all" (click)', recent: ['[Replay] step 1 done'], targets: [] },
      sources({ memory, patterns: [pattern('avoid', 'Never drag mails to the archive icon', 'archive newsletters')] }),
    ).join('\n');
    expect(block).toMatch(/^OPERATION MEMORY/);
    expect(block).toContain('Goal: Archive the newsletters');
    expect(block).toContain('Current objective: "Select all" (click)');
    expect(block).toContain('- Use the bulk select checkbox');
    expect(block).toContain('BLACKLISTED');
    expect(block).toContain('ADVISORY lessons (context, not blockers) — weigh them when planning:\n- [learned avoid] Never drag mails to the archive icon');
    expect(block.indexOf('[learned avoid]')).toBeGreaterThan(block.indexOf('ADVISORY'));
    expect(block).toContain('[failed operation] "Archive" (click) failed in "Archive old newsletters"');
    expect(block).toContain('Similar operations that FAILED before');
    expect(block).toContain('Recent activity (newest first):\n[Replay] step 1 done');
  });

  it('keeps goal and objective but leaves out empty sections for an unrelated operation', () => {
    const memory = addFailure(EMPTY_MEMORY, failure('Archive old newsletters', ['x']));
    const block = memoryBlock({ operation: 'Play the demo video', objective: null, recent: [], targets: [] }, sources({ memory })).join('\n');
    expect(block).toContain('Goal: Play the demo video');
    expect(block).toContain('Current objective: (none — between steps)');
    expect(block).not.toMatch(/BLACKLISTED|ADVISORY|FAILED|Recent activity|Notes:/);
  });

  it('lists structured blacklist rules as BLACKLISTED and prose avoid lessons only as ADVISORY', () => {
    const block = memoryBlock(
      { operation: 'Open the Files app', objective: null, recent: [], targets: ['Files icon'], blocked: ['click "Files icon" near (10.0%, 20.0%)'] },
      sources({ patterns: [pattern('avoid', 'Do not wait if clicking a UI element directly', '')] }),
    );
    const blacklisted = block.indexOf(block.find((l) => l.startsWith('BLACKLISTED'))!);
    const advisory = block.findIndex((l) => l.startsWith('ADVISORY'));
    expect(block[blacklisted + 1]).toBe('- [blacklist rule] click "Files icon" near (10.0%, 20.0%)');
    expect(block[advisory + 1]).toBe('- [learned avoid] Do not wait if clicking a UI element directly');
    expect(advisory).toBeGreaterThan(blacklisted);
  });
});

describe('similarFailures (failure-reminder trigger)', () => {
  it('surfaces failures of the same kind of operation, newest first, and nothing for an unrelated or empty one', () => {
    const older = failure('Rename the project folder', ['a']);
    const newer = failure('rename project folder to 2024', ['b']);
    const other = failure('Play the demo video', ['c']);
    const memory = [newer, older, other].reduceRight(addFailure, EMPTY_MEMORY);
    expect(similarFailures('Rename the project folder', memory.failures)).toEqual([newer, older]);
    expect(similarFailures('Empty the trash', memory.failures)).toEqual([]);
    expect(similarFailures('', memory.failures)).toEqual([]);
  });
});

describe('notes, forget and operationGroups', () => {
  it('ignores blank notes and forgets by id', () => {
    expect(addNote(EMPTY_MEMORY, 'op', '  ')).toBe(EMPTY_MEMORY);
    const m = addNote(addFailure(EMPTY_MEMORY, failure('op one', [])), 'op one', 'note');
    expect(forget(m, m.notes[0].id).notes).toEqual([]);
    expect(forget(m, m.failures[0].id).failures).toEqual([]);
  });

  it('groups notes, failures, blacklist and successes under one operation', () => {
    const memory = addNote(addFailure(EMPTY_MEMORY, failure('Send invoice email', ['"Send" (click)'])), 'send the invoice email', 'Check the recipient');
    const groups = operationGroups(sources({ memory }), [run('Send invoice email now', 'success'), run('Play video', 'failed')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].notes.map((n) => n.text)).toEqual(['Check the recipient']);
    expect(groups[0].failures).toHaveLength(1);
    expect(groups[0].blacklist[0].source).toBe('failure');
    expect(groups[0].successes.map((r) => r.goal)).toEqual(['Send invoice email now']);
  });
});

describe('guards', () => {
  it('accepts stored records and rejects malformed ones', () => {
    expect(isFailureRecord(failure('op', ['a']))).toBe(true);
    expect(isFailureRecord({ ...failure('op', []), shots: ['http://x'] })).toBe(false);
    expect(isOperationNote(addNote(EMPTY_MEMORY, 'op', 'n').notes[0])).toBe(true);
    expect(isOperationNote({ id: 'x', time: 1, operation: '', text: 'n' })).toBe(false);
  });
});
