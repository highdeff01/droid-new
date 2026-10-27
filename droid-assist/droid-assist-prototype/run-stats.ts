import type { Habit, LogEntry, SavedCard, WorkflowStep } from './types.js';
import { runVerdict } from './flow-memory.js';
import { uid } from './planner.js';

/** Most run summaries kept, in memory and in storage (oldest are pruned first). */
export const RUN_SUMMARY_LIMIT = 200;

/** How many entries the "most failed" lists show. */
export const TOP_FAILED = 5;

/** How a finished run ended. Only success and failed count towards success rates and streaks. */
export type RunOutcome = 'success' | 'failed' | 'stopped' | 'dry-run';
export const RUN_OUTCOMES: readonly RunOutcome[] = ['success', 'failed', 'stopped', 'dry-run'];

/** The small persisted record appended at the end of every run. */
export interface RunSummary {
  id: string;
  /** When the run ended. */
  time: number;
  /** The app session (one page load) the run belonged to. */
  session: string;
  goal: string;
  /** Steps that were tried (left pending). */
  attempted: number;
  /** Steps that executed (done, or done after drift correction). */
  succeeded: number;
  durationMs: number;
  outcome: RunOutcome;
  /** The saved flow (card id) the run replayed or was saved as, when any. */
  flowId?: string;
}

/** What a run end knows, for building its summary. */
export interface RunEnd {
  goal: string;
  steps: WorkflowStep[];
  startedAt: number;
  dryRun: boolean;
  stopped: boolean;
  session: string;
  flowId?: string | null;
}

const executed = (s: WorkflowStep) => s.status === 'done' || s.status === 'drift';

/** A finished run's outcome: dry runs and stopped runs first, else the run-memory verdict. */
export function runOutcome(steps: WorkflowStep[], { dryRun, stopped }: { dryRun: boolean; stopped: boolean }): RunOutcome {
  if (dryRun) return 'dry-run';
  if (stopped) return 'stopped';
  return runVerdict(steps, { dryRun, stopped }) === 'success' ? 'success' : 'failed';
}

/** The summary of a run that ended at `now`. */
export function runSummary(end: RunEnd, now = Date.now()): RunSummary {
  return {
    id: uid('run'),
    time: now,
    session: end.session,
    goal: end.goal.trim(),
    attempted: end.steps.filter((s) => s.status !== 'pending').length,
    succeeded: end.steps.filter(executed).length,
    durationMs: Math.max(0, now - end.startedAt),
    outcome: runOutcome(end.steps, end),
    ...(end.flowId ? { flowId: end.flowId } : {}),
  };
}

/** `summary` first, then the existing ones, pruned to the newest RUN_SUMMARY_LIMIT. */
export function appendSummary(summaries: RunSummary[], summary: RunSummary): RunSummary[] {
  return [summary, ...summaries].slice(0, RUN_SUMMARY_LIMIT);
}

const decided = (r: RunSummary) => r.outcome === 'success' || r.outcome === 'failed';
const rate = (successes: number, total: number) => (total ? successes / total : 0);

/** Runs grouped into one day or one session. */
export interface RateBucket {
  key: string;
  /** Time of the bucket's first run. */
  start: number;
  runs: number;
  successes: number;
  failures: number;
  /** successes / (successes + failures); 0 when no run was decided. */
  rate: number;
}

export type BucketBy = 'day' | 'session';

const pad = (n: number) => String(n).padStart(2, '0');
/** The local calendar day of `t` as YYYY-MM-DD. */
export const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const BUCKET_KEY: Record<BucketBy, (r: RunSummary) => string> = { day: (r) => dayKey(r.time), session: (r) => r.session };

/** Success rate over time: one bucket per day or session, oldest first. */
export function successOverTime(summaries: RunSummary[], by: BucketBy): RateBucket[] {
  const buckets = new Map<string, RateBucket>();
  for (const r of [...summaries].sort((a, b) => a.time - b.time)) {
    const key = BUCKET_KEY[by](r);
    const b = buckets.get(key) ?? { key, start: r.time, runs: 0, successes: 0, failures: 0, rate: 0 };
    b.runs += 1;
    if (r.outcome === 'success') b.successes += 1;
    if (r.outcome === 'failed') b.failures += 1;
    b.rate = rate(b.successes, b.successes + b.failures);
    buckets.set(key, b);
  }
  return [...buckets.values()];
}

/** A target or step and how often it failed. */
export interface FailureCount {
  name: string;
  context: string;
  failures: number;
  attempts: number;
}

const byFailures = (a: FailureCount, b: FailureCount) => b.failures - a.failures || b.attempts - a.attempts || a.name.localeCompare(b.name);

/** The habits with the most failed attempts, worst first. */
export function mostFailedTargets(habits: Habit[], limit = TOP_FAILED): FailureCount[] {
  return habits
    .map((h) => ({ name: h.target, context: h.context, failures: h.attempts - h.successes, attempts: h.attempts }))
    .filter((f) => f.failures > 0)
    .sort(byFailures)
    .slice(0, limit);
}

/** Log sources that write one "<step name>: <message>" line per executed step. */
export const STEP_LOG_SOURCES: readonly string[] = ['Replay', 'Self-test', 'Auto-Actor', 'Auto-Actor (dry run)'];

/** The step name of a per-step run log line, or null for any other line. */
function stepName(l: LogEntry): string | null {
  if (!STEP_LOG_SOURCES.includes(l.source)) return null;
  const cut = l.message.indexOf(': ');
  return cut > 0 ? l.message.slice(0, cut).trim() : null;
}

/** The steps the run log records failing most often, worst first; attempts counts every logged try. */
export function mostFailedSteps(log: LogEntry[], limit = TOP_FAILED): FailureCount[] {
  const counts = new Map<string, FailureCount>();
  for (const l of log) {
    const name = stepName(l);
    if (!name) continue;
    const c = counts.get(name) ?? { name, context: '', failures: 0, attempts: 0 };
    c.attempts += 1;
    if (l.tone === 'error') c.failures += 1;
    counts.set(name, c);
  }
  return [...counts.values()].filter((c) => c.failures > 0).sort(byFailures).slice(0, limit);
}

/** Performance of one saved flow across the runs attributed to it. */
export interface FlowStats {
  id: string;
  name: string;
  runs: number;
  successes: number;
  /** Mean steps attempted per run; 0 with no runs. */
  avgSteps: number;
  /** Mean run duration in ms; 0 with no runs. */
  avgDurationMs: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Per-flow performance for every saved card, in card order. */
export function flowStats(cards: SavedCard[], summaries: RunSummary[]): FlowStats[] {
  return cards.map((c) => {
    const runs = summaries.filter((r) => r.flowId === c.id);
    return {
      id: c.id,
      name: c.name,
      runs: runs.length,
      successes: runs.filter((r) => r.outcome === 'success').length,
      avgSteps: mean(runs.map((r) => r.attempted)),
      avgDurationMs: mean(runs.map((r) => r.durationMs)),
    };
  });
}

/** Current and best streaks over decided runs. */
export interface Streaks {
  /** The newest decided runs sharing one outcome; null with none. */
  current: { outcome: 'success' | 'failed'; length: number } | null;
  /** The longest run of consecutive successes. */
  bestSuccess: number;
  /** Consecutive calendar days, ending today or yesterday, with at least one successful run. */
  days: number;
}

/** Length of the newest same-outcome run of `newestFirst`. */
function currentStreak(newestFirst: RunSummary[]): Streaks['current'] {
  if (!newestFirst.length) return null;
  const outcome = newestFirst[0].outcome as 'success' | 'failed';
  const end = newestFirst.findIndex((r) => r.outcome !== outcome);
  return { outcome, length: end === -1 ? newestFirst.length : end };
}

function bestSuccessStreak(newestFirst: RunSummary[]): number {
  let best = 0;
  let run = 0;
  for (const r of newestFirst) {
    run = r.outcome === 'success' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

function dayStreak(summaries: RunSummary[], now: number): number {
  const days = new Set(summaries.filter((r) => r.outcome === 'success').map((r) => dayKey(r.time)));
  const d = new Date(now);
  if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(d.getTime()))) {
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** The current, best and daily success streaks. */
export function streaks(summaries: RunSummary[], now = Date.now()): Streaks {
  const newestFirst = summaries.filter(decided).sort((a, b) => b.time - a.time);
  return { current: currentStreak(newestFirst), bestSuccess: bestSuccessStreak(newestFirst), days: dayStreak(summaries, now) };
}

/** Totals across every recorded run. */
export interface RunTotals {
  runs: number;
  successes: number;
  failures: number;
  rate: number;
}

export function runTotals(summaries: RunSummary[]): RunTotals {
  const successes = summaries.filter((r) => r.outcome === 'success').length;
  const failures = summaries.filter((r) => r.outcome === 'failed').length;
  return { runs: summaries.length, successes, failures, rate: rate(successes, successes + failures) };
}

/** The stores the dashboard reads; nothing here is written. */
export interface StatsSources {
  runs: RunSummary[];
  habits: Habit[];
  log: LogEntry[];
  cards: SavedCard[];
}

/** Everything the Stats panel shows, derived from the persisted stores. */
export function runStats({ runs, habits, log, cards }: StatsSources, by: BucketBy, now = Date.now()) {
  return {
    totals: runTotals(runs),
    overTime: successOverTime(runs, by),
    failedTargets: mostFailedTargets(habits),
    failedSteps: mostFailedSteps(log),
    flows: flowStats(cards, runs),
    streaks: streaks(runs, now),
  };
}
