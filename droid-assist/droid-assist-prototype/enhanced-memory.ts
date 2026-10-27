import type { Habit, LearnedPattern, SavedCard } from './types.js';
import type { WatchTest } from './watcher.js';
import type { RunOutcome, RunSummary } from './run-stats.js';
import { HABIT_MIN_ATTEMPTS, habitLine, isReliable } from './habits.js';
import { patternLine, similarity } from './planner.js';
import { bestPosition, dossierLine, type PositionDossier } from './position-dossier.js';
import { systematicOffset } from './position-compensation.js';

/** What a memory entry remembers: a method (fix script, lesson), an element's usage, a path (saved route), a goal, or a position. */
export type MemoryKind = 'method' | 'usage' | 'path' | 'goal' | 'position';

/** Recent (seen, unproven), important (proven to work) or blacklisted (failed or invalid — avoid). */
export type MemoryStatus = 'recent' | 'important' | 'blacklisted';

/** The store an entry was cross-referenced from. */
export type MemoryOrigin = 'pattern' | 'test' | 'habit' | 'flow' | 'run' | 'dossier';

/** One cross-referenced piece of memory. */
export interface MemoryEntry {
  kind: MemoryKind;
  from: MemoryOrigin;
  status: MemoryStatus;
  /** What the entry is about, matched against an operation. */
  topic: string;
  text: string;
  time: number;
}

/** Every store the memory view cross-references. */
export interface MemorySources {
  cards: SavedCard[];
  habits: Habit[];
  patterns: LearnedPattern[];
  runs: RunSummary[];
  tests: WatchTest[];
  dossiers: PositionDossier[];
}

/** Most entries of each status injected for one operation. */
export const MEMORY_PER_STATUS = 5;

/** Order the statuses are shown and injected in: what to avoid first. */
export const MEMORY_STATUSES: readonly MemoryStatus[] = ['blacklisted', 'important', 'recent'];

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const entry = (kind: MemoryKind, from: MemoryOrigin, status: MemoryStatus, topic: string, text: string, time: number): MemoryEntry => ({ kind, from, status, topic, text, time });

/** Learned patterns (add = important, avoid = blacklisted) and agent test results (passed = important, failed = blacklisted). */
function methodEntries(s: MemorySources): MemoryEntry[] {
  const learned = s.patterns.map((p) => entry('method', 'pattern', p.kind === 'avoid' ? 'blacklisted' : 'important', `${p.pattern} ${p.context}`, patternLine(p), p.time));
  const tested = s.tests.map((t) => entry('method', 'test', t.verdict === 'failed' ? 'blacklisted' : 'important', t.tried,
    `[Agent test ${t.verdict}${t.dryRun ? ', dry run' : ''}] tried "${t.tried}" → ${t.happened}`, t.time));
  return [...learned, ...tested];
}

/** A habit's status: too few attempts is recent, reliable is important, unreliable is blacklisted. */
function habitStatus(h: Habit): MemoryStatus {
  if (h.attempts < HABIT_MIN_ATTEMPTS) return 'recent';
  return isReliable(h) ? 'important' : 'blacklisted';
}

/** Each habit as the element's best usage. */
const usageEntries = (s: MemorySources) => s.habits.map((h) => entry('usage', 'habit', habitStatus(h), h.target, habitLine(h), h.lastUsed));

/** A saved flow's status from the runs that replayed it: last failed is blacklisted, any success is important. */
function pathStatus(runs: RunSummary[]): MemoryStatus {
  if (runs[0]?.outcome === 'failed') return 'blacklisted';
  return runs.some((r) => r.outcome === 'success') ? 'important' : 'recent';
}

/** Each saved flow as a path, with its run statistics. */
function pathEntries(s: MemorySources): MemoryEntry[] {
  return s.cards.map((c) => {
    const runs = s.runs.filter((r) => r.flowId === c.id);
    const ok = runs.filter((r) => r.outcome === 'success').length;
    const route = c.steps.map((st) => `${st.action} "${st.target ?? st.name}"`).join(' → ');
    const text = `[Path] "${c.name}": ${route || 'no steps'} — ${ok}/${runs.length} run(s) succeeded`;
    return entry('path', 'flow', pathStatus(runs), `${c.name} ${c.description}`, text, runs[0]?.time ?? c.savedAt);
  });
}

const GOAL_STATUS: Record<RunOutcome, MemoryStatus> = { success: 'important', failed: 'blacklisted', stopped: 'recent', 'dry-run': 'recent' };

/** Each finished run as a goal attempt. */
const goalEntries = (s: MemorySources) => s.runs.map((r) =>
  entry('goal', 'run', GOAL_STATUS[r.outcome], r.goal, `[Goal ${r.outcome}] "${r.goal}": ${r.succeeded}/${r.attempted} step(s) in ${Math.round(r.durationMs / 1000)} s`, r.time));

/** Each dossier's coordinates and diffs; one with a best or preferred position is important. */
function positionEntries(s: MemorySources): MemoryEntry[] {
  return s.dossiers.map((d) => {
    const offset = systematicOffset(d.tests);
    const diff = offset ? `; lands off by (${pct(offset.x)}, ${pct(offset.y)}) — compensate` : '';
    const status = d.preferred || bestPosition(d) ? 'important' : 'recent';
    return entry('position', 'dossier', status, d.name, `${dossierLine(d)}${diff}`, d.lastSeen);
  });
}

const BUILDERS = [methodEntries, usageEntries, pathEntries, goalEntries, positionEntries];

/** Every store cross-referenced into one memory view, newest first. */
export const buildMemory = (s: MemorySources): MemoryEntry[] => BUILDERS.flatMap((build) => build(s)).sort((a, b) => b.time - a.time);

const related = (a: string, b: string) => similarity(a, b) > 0 || similarity(b, a) > 0;

/** The entries related to `operation`: newest MEMORY_PER_STATUS of each status, blacklisted first; none for a blank operation. */
export function memoryFor(memory: MemoryEntry[], operation: string): MemoryEntry[] {
  if (!operation.trim()) return [];
  const hits = memory.filter((m) => related(operation, m.topic));
  return MEMORY_STATUSES.flatMap((st) => hits.filter((m) => m.status === st).sort((a, b) => b.time - a.time).slice(0, MEMORY_PER_STATUS));
}

/** One AI-context line per entry. */
export const memoryLine = (m: MemoryEntry) => `[Memory ${m.status} ${m.kind}] ${m.text}`;

/** The AI-context lines of the memory related to `operation`. */
export const memoryLines = (memory: MemoryEntry[], operation: string) => memoryFor(memory, operation).map(memoryLine);
