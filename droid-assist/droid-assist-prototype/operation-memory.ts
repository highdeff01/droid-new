import type { Frame, Habit, LearnedPattern, WorkflowStep } from './types.js';
import type { RunSummary } from './run-stats.js';
import { similarity, uid } from './planner.js';

/** How alike two operations must be (in either direction) to be the same kind of operation. */
export const SIMILAR_OPERATION = 0.6;
/** Most failure reminders kept. */
export const FAILURE_LIMIT = 50;
/** Most operation notes kept. */
export const OPERATION_NOTE_LIMIT = 100;
/** Screenshots kept per failure reminder. */
export const FAILURE_SHOTS = 3;
/** Log lines sent as recent activity on every AI turn. */
export const RECENT_LINES = 8;
/** Similar failures sent with one AI turn. */
export const FAILURE_CONTEXT_LIMIT = 5;
/** Blacklist entries sent with one AI turn. */
export const BLACKLIST_LIMIT = 12;
/** How a failed run's automatic avoid pattern ends (flow-memory); its failure reminder carries the same steps. */
export const FAILURE_PATTERN_SUFFIX = 'failed on screen — target or approach did not work';

/** A failed operation saved as a reminder: what failed, on which targets, with its screenshots. */
export interface FailureRecord {
  id: string;
  time: number;
  /** The goal or task the operation was carrying out. */
  operation: string;
  /** Who ran it: Replay, Auto-Actor, Subagent 2, ... */
  actor: string;
  /** What failed, in one line. */
  what: string;
  /** The failed steps as "name (action)". */
  steps: string[];
  /** The on-screen targets of the failed steps. */
  targets: string[];
  /** JPEG data URLs of the screen when it failed (newest last). */
  shots: string[];
}

/** A note the user keeps for one operation; sent with every AI turn of that operation. */
export interface OperationNote {
  id: string;
  time: number;
  operation: string;
  text: string;
}

/** Everything persisted per operation. */
export interface OperationMemory {
  failures: FailureRecord[];
  notes: OperationNote[];
}

/** Memory before anything was remembered. */
export const EMPTY_MEMORY: OperationMemory = { failures: [], notes: [] };

/** Where a blacklisted method was learned. */
export type BlacklistSource = 'pattern' | 'habit' | 'failure';

/** One known-bad method or invalid operation the AI must not repeat. */
export interface BlacklistEntry {
  source: BlacklistSource;
  text: string;
  /** The target a habit lesson was learned on. */
  on?: string;
}

/** The learned knowledge an operation's memory is drawn from. */
export interface MemorySources {
  patterns: LearnedPattern[];
  habits: Habit[];
  memory: OperationMemory;
}

/** True when two operations are the same kind (one covers SIMILAR_OPERATION of the other's meaningful words). */
export const similarOperation = (a: string, b: string) => Math.max(similarity(a, b), similarity(b, a)) >= SIMILAR_OPERATION;

/** True when two target names name the same thing (each covers SIMILAR_OPERATION of the other). */
export const sameTarget = (a: string, b: string) => Math.min(similarity(a, b), similarity(b, a)) >= SIMILAR_OPERATION;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const isFailedStep = (s: WorkflowStep) => s.status === 'failed' || s.status === 'running' || s.status === 'pending';
const stepText = (s: WorkflowStep) => `"${s.name}" (${s.action}${s.target ? ` on ${s.target}` : ''})`;

/** A failure reminder for one operation. */
export function newFailure(f: Omit<FailureRecord, 'id' | 'time' | 'shots'> & { shots: string[] }, now = Date.now()): FailureRecord {
  return { ...f, id: uid('fail'), time: now, operation: f.operation.trim(), shots: f.shots.filter(Boolean).slice(-FAILURE_SHOTS) };
}

/** A failed run as a reminder: its unfinished steps, their targets and the screenshots taken at them (else `live`). */
export function failureFromRun(operation: string, actor: string, steps: WorkflowStep[], live: Frame | null, now = Date.now()): FailureRecord {
  const failed = steps.filter(isFailedStep);
  const stepShots = failed.map((s) => (s.shot ?? s.afterFrame)?.url ?? '').filter(Boolean);
  return newFailure({
    operation,
    actor,
    what: failed.length ? `Step ${failed.map(stepText).join(', ')} did not complete` : 'The run did not complete',
    steps: failed.map(stepText),
    targets: failed.map((s) => s.target ?? s.name),
    shots: stepShots.length ? stepShots : live ? [live.url] : [],
  }, now);
}

/** `memory` with `failure` first, at most FAILURE_LIMIT. */
export const addFailure = (memory: OperationMemory, failure: FailureRecord): OperationMemory => ({ ...memory, failures: [failure, ...memory.failures].slice(0, FAILURE_LIMIT) });

/** `memory` with a note for `operation` first; a blank note or operation leaves it as is. */
export function addNote(memory: OperationMemory, operation: string, text: string, now = Date.now()): OperationMemory {
  if (!operation.trim() || !text.trim()) return memory;
  const note: OperationNote = { id: uid('note'), time: now, operation: operation.trim(), text: text.trim() };
  return { ...memory, notes: [note, ...memory.notes].slice(0, OPERATION_NOTE_LIMIT) };
}

/** `memory` without the failure or note `id`. */
export const forget = (memory: OperationMemory, id: string): OperationMemory => ({ failures: memory.failures.filter((f) => f.id !== id), notes: memory.notes.filter((n) => n.id !== id) });

/** The failure reminders of operations like `operation`, newest first. */
export const similarFailures = (operation: string, failures: FailureRecord[]) => (operation.trim() ? failures.filter((f) => similarOperation(operation, f.operation)) : []);

/** The notes kept for operations like `operation`, newest first. */
export const notesFor = (operation: string, notes: OperationNote[]) => (operation.trim() ? notes.filter((n) => similarOperation(operation, n.operation)) : []);

/** The successful runs of operations like `operation`, newest first. */
export const successesFor = (operation: string, runs: RunSummary[]) => (operation.trim() ? runs.filter((r) => r.outcome === 'success' && similarOperation(operation, r.goal)) : []);

/** The quoted step names in a failed run's automatic avoid pattern. */
const patternSteps = (text: string) => [...text.matchAll(/"([^"]+)" \(/g)].map((m) => m[1]);

/** True when `p` is a failed run's automatic pattern whose every step a kept failure reminder already lists. */
function coveredByFailures(p: LearnedPattern, failures: FailureRecord[]): boolean {
  if (!p.pattern.endsWith(FAILURE_PATTERN_SUFFIX)) return false;
  const names = patternSteps(p.pattern);
  return names.length > 0 && names.every((n) => failures.some((f) => f.steps.some((s) => s.startsWith(`"${n}" (`))));
}

/**
 * Avoid patterns learned for this kind of operation (or for any operation). A failed run's
 * automatic pattern is left out when the similar failure reminders already list all its steps.
 */
const patternEntries = (operation: string, patterns: LearnedPattern[], failures: FailureRecord[]): BlacklistEntry[] => patterns
  .filter((p) => p.kind === 'avoid' && (!p.context.trim() || similarOperation(operation, p.context)))
  .filter((p) => !coveredByFailures(p, failures))
  .map((p) => ({ source: 'pattern', text: p.pattern }));

/** Avoid lessons of the habits for the operation's targets, or whose target the operation names. */
function habitEntries(operation: string, targets: string[], habits: Habit[]): BlacklistEntry[] {
  const concerns = (h: Habit) => targets.some((t) => sameTarget(t, h.target)) || similarity(h.target, operation) >= SIMILAR_OPERATION;
  return habits.filter(concerns).flatMap((h) => h.lessons.filter((l) => l.kind === 'avoid').map((l): BlacklistEntry => ({ source: 'habit', text: l.text, on: h.target })));
}

/** The failed steps of similar operations, as invalid operations. */
const failureEntries = (failures: FailureRecord[]): BlacklistEntry[] => failures.flatMap((f) => (f.steps.length ? f.steps : [f.what]).map((s): BlacklistEntry => ({ source: 'failure', text: `${s} failed in "${f.operation}"` })));

/** The lists taken in turn, one entry from each, so no source crowds the others out. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) lists.forEach((l) => { if (i < l.length) out.push(l[i]); });
  return out;
}

/**
 * The blacklist of `operation`: avoid patterns for its kind, avoid lessons of the habits for its
 * targets (given, plus those its similar failures failed on) and the failed steps of similar
 * operations, taken in turn from each source; one entry per text (case-insensitive), at most BLACKLIST_LIMIT.
 */
export function blacklistFor(operation: string, targets: string[], src: MemorySources): BlacklistEntry[] {
  if (!operation.trim() && !targets.length) return [];
  const failures = similarFailures(operation, src.memory.failures);
  const allTargets = [...targets, ...failures.flatMap((f) => f.targets)];
  const seen = new Set<string>();
  return interleave([failureEntries(failures), patternEntries(operation, src.patterns, failures), habitEntries(operation, allTargets, src.habits)]).filter((e) => {
    const key = norm(e.text);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, BLACKLIST_LIMIT);
}

const SOURCE_LABEL: Record<BlacklistSource, string> = { pattern: 'learned avoid', habit: 'habit avoid', failure: 'failed operation' };

/** A blacklist entry as one prompt line. */
export const blacklistLine = (e: BlacklistEntry) => `- [${SOURCE_LABEL[e.source]}] ${e.text}${e.on ? ` (on "${e.on}")` : ''}`;

/** A failure reminder as one line. */
export const failureLine = (f: FailureRecord) => `"${f.operation}" (${f.actor}, ${new Date(f.time).toISOString()}): ${f.what}`;

/** What one AI turn of an operation is sent with. */
export interface TurnMemory {
  operation: string;
  /** The step being worked on now, as text; null between steps. */
  objective: string | null;
  /** Recent log lines, newest first. */
  recent: string[];
  /** Targets of the operation's current steps. */
  targets: string[];
}

/**
 * The operation memory block sent with every AI turn: the goal, the current objective, the
 * operation's notes, the BLACKLISTED methods it must not repeat, its similar failed operations
 * and the recent activity. Empty sections are left out, the goal and objective never are.
 */
export function memoryBlock(turn: TurnMemory, src: MemorySources): string[] {
  const notes = notesFor(turn.operation, src.memory.notes);
  const blacklist = blacklistFor(turn.operation, turn.targets, src);
  const failures = similarFailures(turn.operation, src.memory.failures).slice(0, FAILURE_CONTEXT_LIMIT);
  return [
    'OPERATION MEMORY (applies to this whole operation):',
    `Goal: ${turn.operation.trim() || '(none)'}`,
    `Current objective: ${turn.objective ?? '(none — between steps)'}`,
    ...(notes.length ? ['Notes:', ...notes.map((n) => `- ${n.text}`)] : []),
    ...(blacklist.length ? ['BLACKLISTED — known-bad methods and invalid operations; never repeat them, choose a different approach:', ...blacklist.map(blacklistLine)] : []),
    ...(failures.length ? ['Similar operations that FAILED before — adjust your approach:', ...failures.map((f) => `- ${failureLine(f)}`)] : []),
    ...(turn.recent.length ? ['Recent activity (newest first):', ...turn.recent] : []),
  ];
}

/** A step as the current objective's text. */
export const objectiveText = (s: WorkflowStep) => `${stepText(s)}`;

/** One operation's memory as the panel shows it. */
export interface OperationGroup {
  operation: string;
  notes: OperationNote[];
  failures: FailureRecord[];
  blacklist: BlacklistEntry[];
  successes: RunSummary[];
}

/**
 * Every remembered operation (from notes, failures and successful runs), similar ones grouped
 * under the first-seen name, newest first, with its notes, failures, blacklist and successes.
 */
export function operationGroups(src: MemorySources, runs: RunSummary[]): OperationGroup[] {
  const names: string[] = [];
  const seen = [...src.memory.notes, ...src.memory.failures].map((x) => ({ time: x.time, operation: x.operation }));
  const wins = runs.filter((r) => r.outcome === 'success').map((r) => ({ time: r.time, operation: r.goal }));
  [...seen, ...wins].sort((a, b) => b.time - a.time).forEach(({ operation }) => {
    if (operation.trim() && !names.some((n) => similarOperation(n, operation))) names.push(operation.trim());
  });
  return names.map((operation) => ({
    operation,
    notes: notesFor(operation, src.memory.notes),
    failures: similarFailures(operation, src.memory.failures),
    blacklist: blacklistFor(operation, [], src),
    successes: successesFor(operation, runs),
  }));
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

/** True when `v` is a well-formed failure reminder. */
export function isFailureRecord(v: unknown): v is FailureRecord {
  return isObject(v) && typeof v.id === 'string' && isNum(v.time) && typeof v.operation === 'string' && typeof v.actor === 'string'
    && typeof v.what === 'string' && isStrings(v.steps) && isStrings(v.targets) && isStrings(v.shots) && v.shots.every((s) => s.startsWith('data:image/'));
}

/** True when `v` is a well-formed operation note. */
export function isOperationNote(v: unknown): v is OperationNote {
  return isObject(v) && typeof v.id === 'string' && isNum(v.time) && typeof v.operation === 'string' && !!v.operation.trim() && typeof v.text === 'string' && !!v.text.trim();
}
