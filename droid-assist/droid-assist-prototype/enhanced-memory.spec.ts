import { describe, expect, it } from 'vitest';
import { MEMORY_PER_STATUS, buildMemory, memoryFor, memoryLines, type MemorySources } from './enhanced-memory.js';
import { recordObservation, recordOutcome, recordTest } from './position-dossier.js';
import type { Habit, LearnedPattern, SavedCard } from './types.js';
import type { RunSummary } from './run-stats.js';
import type { WatchTest } from './watcher.js';

const sources = (over: Partial<MemorySources> = {}): MemorySources => ({ cards: [], habits: [], patterns: [], runs: [], tests: [], dossiers: [], ...over });
const habit = (over: Partial<Habit>): Habit => ({ id: 'h', target: 'Export button', context: '', attempts: 0, successes: 0, lastUsed: 1, lessons: [], pinned: false, ...over });
const run = (over: Partial<RunSummary>): RunSummary => ({ id: 'r', time: 1, session: 's', goal: 'export the report', attempted: 2, succeeded: 2, durationMs: 4000, outcome: 'success', ...over });
const card: SavedCard = { id: 'c1', name: 'Export report', description: 'export the monthly report', savedAt: 1, steps: [{ id: 's', name: 'Export', action: 'click', x: 0.5, y: 0.5, target: 'Export button', status: 'pending' }] };
const pattern = (kind: LearnedPattern['kind'], time = 1): LearnedPattern => ({ id: `p${time}`, kind, pattern: `${kind} confirm the export dialog`, context: 'export report', time });
const watchTest = (verdict: WatchTest['verdict']): WatchTest => ({ id: verdict, time: 3, proposalId: 'x', tried: 'click export button twice', happened: 'nothing', verdict, dryRun: false });

describe('buildMemory', () => {
  it('blacklists avoid patterns, failed agent tests, unreliable habits and failed runs', () => {
    const memory = buildMemory(sources({
      patterns: [pattern('avoid')],
      tests: [watchTest('failed')],
      habits: [habit({ attempts: 4, successes: 1 })],
      runs: [run({ outcome: 'failed' })],
    }));
    expect(memory.map((m) => [m.kind, m.status])).toEqual(expect.arrayContaining([['method', 'blacklisted'], ['method', 'blacklisted'], ['usage', 'blacklisted'], ['goal', 'blacklisted']]));
    expect(memory.every((m) => m.status === 'blacklisted')).toBe(true);
  });

  it('marks add patterns, passed tests, reliable habits and successful runs important; unproven habits and stopped runs recent', () => {
    const memory = buildMemory(sources({
      patterns: [pattern('add')],
      tests: [watchTest('passed')],
      habits: [habit({ id: 'a', attempts: 4, successes: 4 }), habit({ id: 'b', target: 'Close', attempts: 1, successes: 1 })],
      runs: [run({ id: 'ok' }), run({ id: 'st', outcome: 'stopped' })],
    }));
    const statusOf = (kind: string) => memory.filter((m) => m.kind === kind).map((m) => m.status);
    expect(statusOf('method')).toEqual(['important', 'important']);
    expect(statusOf('usage').sort()).toEqual(['important', 'recent']);
    expect(statusOf('goal').sort()).toEqual(['important', 'recent']);
  });

  it('cross-references a saved path with the runs that replayed it', () => {
    const memory = buildMemory(sources({ cards: [card], runs: [run({ id: 'b', time: 9, flowId: 'c1', outcome: 'failed' }), run({ id: 'a', time: 5, flowId: 'c1' })] }));
    const path = memory.find((m) => m.kind === 'path')!;
    expect(path.status).toBe('blacklisted');
    expect(path.text).toBe('[Path] "Export report": click "Export button" — 1/2 run(s) succeeded');
  });

  it('includes coordinates and the measured planned-vs-actual offset of each dossier', () => {
    let dossiers = recordObservation([], { name: 'Export button', x: 0.5, y: 0.5, time: 1, by: 'user' });
    for (const t of [2, 3, 4]) dossiers = recordTest(dossiers, 'Export button', { x: 0.5, y: 0.5 }, { x: 0.52, y: 0.5 }, t);
    dossiers = recordOutcome(recordOutcome(dossiers, 'Export button', { x: 0.52, y: 0.5 }, true, 5), 'Export button', { x: 0.52, y: 0.5 }, true, 6);
    const [position] = buildMemory(sources({ dossiers }));
    expect(position).toMatchObject({ kind: 'position', status: 'important' });
    expect(position.text).toContain('[Position] "Export button"');
    expect(position.text).toContain('lands off by (2.0%, 0.0%) — compensate');
  });

  it('orders entries newest first', () => {
    const memory = buildMemory(sources({ patterns: [pattern('add', 1), pattern('avoid', 7)], runs: [run({ time: 4 })] }));
    expect(memory.map((m) => m.time)).toEqual([7, 4, 1]);
  });
});

describe('memoryFor / memoryLines', () => {
  it('keeps only entries related to the operation, blacklisted first then important then recent', () => {
    const memory = buildMemory(sources({
      patterns: [pattern('add'), { id: 'o', kind: 'avoid', pattern: 'open the browser menu', context: 'browse', time: 2 }],
      runs: [run({ outcome: 'failed', time: 5 }), run({ id: 's', outcome: 'stopped', time: 6 })],
    }));
    const hits = memoryFor(memory, 'export the report');
    expect(hits.map((m) => m.status)).toEqual(['blacklisted', 'important', 'recent']);
    expect(hits.some((m) => m.text.includes('browser menu'))).toBe(false);
  });

  it('caps each status at MEMORY_PER_STATUS newest entries', () => {
    const runs = Array.from({ length: MEMORY_PER_STATUS + 3 }, (_, i) => run({ id: `r${i}`, time: i, outcome: 'failed' }));
    const hits = memoryFor(buildMemory(sources({ runs })), 'export report');
    expect(hits).toHaveLength(MEMORY_PER_STATUS);
    expect(hits[0].time).toBe(MEMORY_PER_STATUS + 2);
  });

  it('returns nothing for a blank operation', () => {
    expect(memoryFor(buildMemory(sources({ runs: [run({})] })), '  ')).toEqual([]);
  });

  it('formats one context line per entry with its status and kind', () => {
    const lines = memoryLines(buildMemory(sources({ runs: [run({ outcome: 'failed', succeeded: 1 })] })), 'export the report');
    expect(lines).toEqual(['[Memory blacklisted goal] [Goal failed] "export the report": 1/2 step(s) in 4 s']);
  });
});
