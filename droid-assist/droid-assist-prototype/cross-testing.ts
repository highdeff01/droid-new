import type { Habit } from './types.js';

/**
 * Cross-app testing and habit formation: each app runs tests in its own domain, goals are tested in
 * the background using screenshots and cross-referenced against previous methods, history and logs
 * from both apps, and the apps cross-reference each other's routes so a successful method in either
 * strengthens the habit in both. The merge is pure: the caller decides what to write back.
 */

/** Where a test's evidence came from. */
export type TestOrigin = 'droid-new' | 'droid-main';

/** One background test result, as it feeds habit formation. */
export interface CrossTest {
  /** Which app ran it. */
  app: TestOrigin;
  /** The goal or element the test was about. */
  subject: string;
  /** The method (route) the test used. */
  method: string;
  ok: boolean;
  /** One line of evidence: what the screenshot/history/log showed. */
  evidence: string;
  /** When it ran. */
  at: number;
}

/** One prior method recalled from either app's history. */
export interface PriorMethod {
  app: TestOrigin;
  subject: string;
  method: string;
  ok: boolean;
  at: number;
}

/** A habit update to apply in a store, and where it should land. */
export interface HabitUpdate {
  /** Both apps end up with it: a success in either strengthens the habit in both. */
  target: string;
  context: string;
  success: boolean;
  /** Which app's test produced it. */
  from: TestOrigin;
}

/** Whether `subject` and `method` are close enough to count as the same route (case/space-insensitive). */
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const sameRoute = (a: string, b: string) => norm(a) === norm(b);

/**
 * The prior methods for `subject` from both apps' histories, newest first, so a test is judged
 * against what either app already knew rather than a single app's memory.
 */
export function recallMethods(history: readonly PriorMethod[], subject: string): PriorMethod[] {
  return history.filter((m) => sameRoute(m.subject, subject)).sort((a, b) => b.at - a.at);
}

/**
 * The evidence context for a test: what each app's history and logs say about the subject, so the
 * background test cross-references both apps' methods. `logs` are one-line log excerpts.
 */
export function crossReference(subject: string, history: readonly PriorMethod[], logs: readonly string[]): string[] {
  const lines = recallMethods(history, subject).slice(0, 5).map((m) => `[${m.app} ${m.ok ? 'worked' : 'failed'}] ${m.method}`);
  return [...lines, ...logs.slice(0, 5).map((l) => `log: ${l}`)];
}

/**
 * Turns test results into habit updates both apps should share: a success in one app produces a
 * success update (strengthening the habit in both), a failure produces a failure update. Results
 * are folded per subject+method, and the most recent result wins, so a method re-tested is not
 * double-counted.
 */
export function habitUpdates(results: readonly CrossTest[]): HabitUpdate[] {
  const byRoute = new Map<string, CrossTest>();
  for (const r of results) {
    const key = `${norm(r.subject)}\u0000${norm(r.method)}`;
    const current = byRoute.get(key);
    if (!current || r.at >= current.at) byRoute.set(key, r);
  }
  return [...byRoute.values()]
    .sort((a, b) => b.at - a.at)
    .map((r) => ({ target: r.subject, context: r.method, success: r.ok, from: r.app }));
}

/**
 * Applies habit updates to a local habit list: matching habits gain an attempt (and a success when
 * the test passed); a habit for a route no store had yet is created. This is how a success in either
 * app strengthens the habit in both — the caller runs it on both stores.
 */
export function applyHabitUpdates(habits: readonly Habit[], updates: readonly HabitUpdate[], now = Date.now()): Habit[] {
  const key = (target: string, context: string) => `${norm(target)}@${norm(context)}`;
  const out = habits.map((h) => ({ ...h, lessons: [...h.lessons] }));
  for (const u of updates) {
    const i = out.findIndex((h) => key(h.target, h.context) === key(u.target, u.context));
    if (i === -1) {
      out.unshift({ id: `habit-x-${now.toString(36)}-${out.length}`, target: u.target.trim(), context: u.context.trim(), attempts: 1, successes: u.success ? 1 : 0, lastUsed: now, lessons: [{ kind: u.success ? 'add' : 'avoid', text: `cross-app test on ${u.from}: ${u.success ? 'passed' : 'failed'}`, time: now }], pinned: false });
      continue;
    }
    const h = out[i];
    out[i] = { ...h, attempts: h.attempts + 1, successes: h.successes + (u.success ? 1 : 0), lastUsed: now, lessons: [...h.lessons, { kind: u.success ? 'add' as const : 'avoid' as const, text: `cross-app test on ${u.from}: ${u.success ? 'passed' : 'failed'}`, time: now }].slice(-6) };
  }
  return out;
}

/** One line summarising a batch of cross-app tests for the log. */
export function crossTestLine(results: readonly CrossTest[]): string {
  const passed = results.filter((r) => r.ok).length;
  const apps = [...new Set(results.map((r) => r.app))].join(', ');
  return `Cross-app tests (${apps}): ${passed}/${results.length} passed — habits strengthened in both apps`;
}
