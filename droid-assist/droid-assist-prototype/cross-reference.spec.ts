import { describe, expect, it } from 'vitest';
import { AGREE_DISTANCE, conflictsOf, crossReference, type CrossCheck, type Knowledge } from './cross-reference.js';
import type { MappedElement } from './element-map-studio.js';
import type { FamiliarElement, Habit, LearnedPattern } from './types.js';
import { newFailure } from './operation-memory.js';
import { recordObservation, recordOutcome, setPreferred, type PositionDossier } from './position-dossier.js';
import { buildMemory } from './enhanced-memory.js';
import type { WatchTest } from './watcher.js';

const target = 'Play button';
const point = { x: 0.5, y: 0.5 };

const knowledge = (over: Partial<Knowledge> = {}): Knowledge => ({ map: [], familiar: [], habits: [], patterns: [], failures: [], dossiers: [], memory: [], context: 'Media App', ...over });

const mapped = (over: Partial<MappedElement> = {}): MappedElement => ({ id: 'e1', name: 'Play icon', box: { x: 0, y: 0, w: 0.1, h: 0.1 }, mappedAt: 0, ...over });

const familiar = (over: Partial<FamiliarElement> = {}): FamiliarElement => ({ id: 'f1', name: 'Play button', x: 0.5, y: 0.5, lastSeen: 0, ...over });

const habit = (over: Partial<Habit> = {}): Habit => ({ id: 'h1', target: 'Play button', context: 'Media App', attempts: 0, successes: 0, lastUsed: 0, lessons: [], pinned: false, ...over });

describe('crossReference — mapped elements', () => {
  it('marks a mapped element covering the point consistent when its name shares a word with the target', () => {
    const el = mapped({ name: 'Play button', box: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } });
    const checks = crossReference(target, point, knowledge({ map: [el] }));
    expect(checks).toContainEqual({ source: 'mapped', status: 'consistent', text: 'Mapped element "Play button" covers the planned point' });
  });

  it('marks a mapped element of a different name covering the point conflicting', () => {
    const el = mapped({ name: 'Settings panel', box: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } });
    const checks = crossReference(target, point, knowledge({ map: [el] }));
    expect(checks).toContainEqual({ source: 'mapped', status: 'conflicting', text: 'Mapped element "Settings panel" covers the planned point, not "Play button"' });
  });

  it('marks a mapped element named like the target but not covering the point conflicting', () => {
    const el = mapped({ name: 'Play icon', box: { x: 0, y: 0, w: 0.1, h: 0.1 } });
    const checks = crossReference(target, point, knowledge({ map: [el] }));
    expect(checks).toContainEqual({ source: 'mapped', status: 'conflicting', text: 'Mapped element "Play icon" is elsewhere — its boundary does not contain the planned point' });
  });
});

describe('crossReference — learned (familiar elements)', () => {
  it('is consistent when the familiar element is within AGREE_DISTANCE of the plan', () => {
    const el = familiar({ x: 0.51, y: 0.5, timesSeen: 2 });
    const checks = crossReference(target, point, knowledge({ familiar: [el] }));
    expect(checks).toContainEqual(expect.objectContaining({ source: 'learned', status: 'consistent' }));
  });

  it('is conflicting when the familiar element is farther than AGREE_DISTANCE from the plan', () => {
    const el = familiar({ x: 0.5 + AGREE_DISTANCE + 0.05, y: 0.5 });
    const checks = crossReference(target, point, knowledge({ familiar: [el] }));
    expect(checks).toContainEqual(expect.objectContaining({ source: 'learned', status: 'conflicting' }));
  });
});

describe('crossReference — learned (habit anchors)', () => {
  it('is consistent when a habit anchor for this target in this context is within AGREE_DISTANCE', () => {
    const h = habit({ anchor: { x: 0.52, y: 0.5, patch: [], size: 16, time: 0 } });
    const checks = crossReference(target, point, knowledge({ habits: [h] }));
    expect(checks).toContainEqual(expect.objectContaining({ source: 'learned', status: 'consistent', text: expect.stringContaining('Habit anchor of "Play button"') }));
  });

  it('is conflicting when a habit anchor is farther than AGREE_DISTANCE', () => {
    const h = habit({ anchor: { x: 0.5 + AGREE_DISTANCE + 0.05, y: 0.5, patch: [], size: 16, time: 0 } });
    const checks = crossReference(target, point, knowledge({ habits: [h] }));
    expect(checks).toContainEqual(expect.objectContaining({ source: 'learned', status: 'conflicting', text: expect.stringContaining('Habit anchor of "Play button"') }));
  });

  it('ignores a habit anchor from a different context', () => {
    const h = habit({ context: 'Other App', anchor: { x: 0.9, y: 0.9, patch: [], size: 16, time: 0 } });
    const checks = crossReference(target, point, knowledge({ habits: [h] }));
    expect(checks.filter((c) => c.source === 'learned')).toEqual([]);
  });
});

describe('crossReference — habit success rate', () => {
  it('is conflicting when a judged habit (attempts >= 3) has a success rate below 0.5', () => {
    const h = habit({ attempts: 3, successes: 0 });
    const checks = crossReference(target, point, knowledge({ habits: [h] }));
    expect(checks).toContainEqual(expect.objectContaining({ source: 'habit', status: 'conflicting' }));
  });

  it('is consistent when a judged habit has a reliable success rate', () => {
    const h = habit({ attempts: 3, successes: 2 });
    const checks = crossReference(target, point, knowledge({ habits: [h] }));
    expect(checks).toContainEqual(expect.objectContaining({ source: 'habit', status: 'consistent' }));
  });
});

describe('crossReference — avoid patterns', () => {
  it('marks a learned avoid-pattern sharing a word with the target conflicting', () => {
    const pattern: LearnedPattern = { id: 'p1', kind: 'avoid', pattern: 'Play button double click', context: '', time: 0 };
    const checks = crossReference(target, point, knowledge({ patterns: [pattern] }));
    expect(checks).toContainEqual({ source: 'avoid', status: 'conflicting', text: 'Learned avoid: Play button double click' });
  });

  it('ignores an "add" pattern', () => {
    const pattern: LearnedPattern = { id: 'p1', kind: 'add', pattern: 'Play button double click', context: '', time: 0 };
    const checks = crossReference(target, point, knowledge({ patterns: [pattern] }));
    expect(checks.filter((c) => c.source === 'avoid')).toEqual([]);
  });

  it('marks a habit avoid-lesson for this target conflicting', () => {
    const h = habit({ lessons: [{ kind: 'avoid', text: 'double-click triggers an error', time: 0 }] });
    const checks = crossReference(target, point, knowledge({ habits: [h] }));
    expect(checks).toContainEqual({ source: 'avoid', status: 'conflicting', text: 'Habit avoid: double-click triggers an error' });
  });
});

describe('crossReference — failure reminders', () => {
  const failure = (targets: string[]) => newFailure({ operation: 'Play the intro video', actor: 'Subagent 1', what: 'Step "Play" did not complete', steps: [], targets, shots: [] }, 0);

  it('marks a failure reminder on this target conflicting', () => {
    const checks = crossReference(target, point, knowledge({ failures: [failure(['play button'])] }));
    expect(checks.filter((c) => c.source === 'failure')).toEqual([{ source: 'failure', status: 'conflicting', text: expect.stringContaining('Failed before: "Play the intro video" (Subagent 1') }]);
  });

  it('ignores failures on other targets', () => {
    expect(crossReference(target, point, knowledge({ failures: [failure(['Settings gear'])] })).filter((c) => c.source === 'failure')).toEqual([]);
  });
});

describe('crossReference — position dossiers', () => {
  const seen = (x: number, y: number, time: number): PositionDossier[] => recordObservation([], { name: 'Play button', x, y, time, by: 'user' });

  it('reports nothing for a static element with no best or preferred position', () => {
    const checks = crossReference(target, point, knowledge({ dossiers: seen(0.9, 0.9, 1) }));
    expect(checks.filter((c) => c.source === 'position')).toEqual([]);
  });

  it('marks a preferred position far from the plan conflicting and a near best position consistent', () => {
    let list = seen(0.5, 0.5, 1);
    list = recordOutcome(recordOutcome(list, 'Play button', { x: 0.51, y: 0.5 }, true, 2), 'Play button', { x: 0.51, y: 0.5 }, true, 3);
    list = setPreferred(list, 'Play button', { x: 0.2, y: 0.2, by: 'user' });
    const checks = crossReference(target, point, knowledge({ dossiers: list })).filter((c) => c.source === 'position');
    expect(checks.map((c) => c.status)).toEqual(['conflicting', 'consistent']);
    expect(checks[0].text).toContain('Preferred position of "Play button" (set by user)');
    expect(checks[1].text).toContain('Best position of "Play button" (2/2 succeeded)');
  });

  it('checks the last-known position of an element that moved', () => {
    const list = recordObservation(seen(0.5, 0.5, 1), { name: 'Play button', x: 0.8, y: 0.8, time: 5000, by: 'ai' });
    const [check] = crossReference(target, point, knowledge({ dossiers: list })).filter((c) => c.source === 'position');
    expect(check).toMatchObject({ status: 'conflicting' });
    expect(check.text).toContain('Last-known position of "Play button" (moved-by-ai)');
  });
});

describe('crossReference — enhanced memory', () => {
  const test = (verdict: WatchTest['verdict']): WatchTest => ({ id: verdict, time: verdict === 'failed' ? 2 : 1, proposalId: 'p', tried: `press play button (${verdict})`, happened: 'video started', verdict, dryRun: false });

  it('marks a failed agent test for the target conflicting and a passed one consistent', () => {
    const memory = buildMemory({ cards: [], habits: [], patterns: [], runs: [], dossiers: [], tests: [test('failed'), test('passed')] });
    const checks = crossReference(target, point, knowledge({ memory })).filter((c) => c.source === 'memory');
    expect(checks.map((c) => c.status)).toEqual(['conflicting', 'consistent']);
  });

  it('does not repeat patterns already reported by the avoid check', () => {
    const pattern: LearnedPattern = { id: 'l', kind: 'avoid', pattern: 'play button double click', context: '', time: 1 };
    const memory = buildMemory({ cards: [], habits: [], patterns: [pattern], runs: [], dossiers: [], tests: [] });
    const checks = crossReference(target, point, knowledge({ patterns: [pattern], memory }));
    expect(checks.filter((c) => c.source === 'memory')).toEqual([]);
    expect(checks.filter((c) => c.source === 'avoid')).toHaveLength(1);
  });
});

describe('conflictsOf', () => {
  it('keeps only conflicting entries', () => {
    const list: CrossCheck[] = [
      { source: 'mapped', status: 'consistent', text: 'a' },
      { source: 'learned', status: 'conflicting', text: 'b' },
      { source: 'habit', status: 'consistent', text: 'c' },
      { source: 'avoid', status: 'conflicting', text: 'd' },
    ];
    expect(conflictsOf(list)).toEqual([list[1], list[3]]);
  });
});
