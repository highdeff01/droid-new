import type { WorkflowStep } from './types.js';
import { POINTER_ACTIONS } from './types.js';
import type { Box } from './assist-ai.js';
import type { RouteHop } from './route-plot.js';
import type { FixContext, FixScript } from './fix-script.js';
import type { SideTestMode, SideTestPlan } from './side-test.js';
import { uid } from './planner.js';

/** Most hops an automatically saved access path keeps (the last ones leading to its target). */
export const TRAIL_LIMIT = 6;
/** Uses of one target that make it due for an automatic side test. */
export const SIDE_TEST_USES = 3;
/** How long a side-tested target rests before it is side-tested again. */
export const SIDE_TEST_COOLDOWN_MS = 10 * 60_000;
/** Most automatic side tests started after one run. */
export const SIDE_TESTS_PER_RUN = 2;

/** How often the AI acted on one target, how often that failed, and where it last was. */
export interface Interaction {
  name: string;
  uses: number;
  failures: number;
  x: number;
  y: number;
}

/** Interactions keyed by the target's case-insensitive name. */
export type Interactions = Record<string, Interaction>;

const key = (s: string) => s.trim().toLowerCase();

/**
 * The element → element access path that reached step `upTo`: the pointer steps of the run that
 * executed before it (status done) plus the step itself, at their corrected points, at most TRAIL_LIMIT.
 */
export function routeTrail(steps: WorkflowStep[], upTo: number): RouteHop[] {
  const used = steps.slice(0, upTo + 1).filter((s, i) => POINTER_ACTIONS.has(s.action) && (i === upTo || s.status === 'done'));
  return used.slice(-TRAIL_LIMIT).map((s, i) => ({ name: s.target ?? s.name, x: s.correctedX ?? s.x, y: s.correctedY ?? s.y, via: i === 0 ? 'start' : 'opens' }));
}

/** A step that succeeded after failing as a one-step fix script, ready to be remembered as the fix method of its element and flow. */
export const correctionFix = (ctx: FixContext, step: WorkflowStep): FixScript => ({
  id: uid('fixscript'),
  context: ctx,
  steps: [{ ...step, id: uid('fix'), status: 'pending' }],
  source: 'ai',
  reason: 'corrected approach',
});

/** Counts one use of `name` at `at` and whether it failed. */
export function noteInteraction(counts: Interactions, name: string, at: { x: number; y: number }, ok: boolean): Interactions {
  const k = key(name);
  if (!k) return counts;
  const old = counts[k];
  return { ...counts, [k]: { name: name.trim(), uses: (old?.uses ?? 0) + 1, failures: (old?.failures ?? 0) + (ok ? 0 : 1), x: at.x, y: at.y } };
}

/**
 * The targets due for an automatic side test: any failure or SIDE_TEST_USES uses, not side-tested in
 * the last SIDE_TEST_COOLDOWN_MS; failures first, then the most used, at most SIDE_TESTS_PER_RUN.
 */
export function sideTestDue(counts: Interactions, lastTested: Record<string, number>, now: number): Interaction[] {
  const due = Object.entries(counts).filter(([k, c]) => (c.failures > 0 || c.uses >= SIDE_TEST_USES) && now - (lastTested[k] ?? -Infinity) >= SIDE_TEST_COOLDOWN_MS);
  return due.map(([, c]) => c).sort((a, b) => b.failures - a.failures || b.uses - a.uses).slice(0, SIDE_TESTS_PER_RUN);
}

/** The key `lastTested` records a side-tested target under. */
export const interactionKey = key;

/** The automatic side test of a target: hover it (experiment), capture the result and backtrack, staying on the main app. */
export const autoSideTestPlan = (c: Interaction, mode: SideTestMode): SideTestPlan => ({
  name: `Auto side test "${c.name}" (${c.uses} use(s), ${c.failures} failure(s))`,
  target: '',
  mode,
  experiment: { id: uid('side'), name: `Hover "${c.name}"`, action: 'move', target: c.name, x: c.x, y: c.y, status: 'pending' },
});

/** A small box centred on a point, for section memory events. */
export const pointBox = (p: { x: number; y: number }, size = 0.02): Box => ({ x: Math.max(0, p.x - size / 2), y: Math.max(0, p.y - size / 2), w: size, h: size });
