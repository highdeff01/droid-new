import type { FamiliarElement, Habit, LearnedPattern } from './types.js';
import { mappedAt, type MappedElement } from './element-map-studio.js';
import { findFamiliar } from './coords.js';
import { habitKey, isReliable, successRate } from './habits.js';
import { similarity } from './planner.js';

/** Whether a piece of known knowledge agrees with the planned coordinates. */
export type Agreement = 'consistent' | 'conflicting';

/** Which kind of knowledge an entry comes from. */
export type CrossSource = 'mapped' | 'learned' | 'habit' | 'avoid';

/** One cross-reference entry: what is known, and whether it agrees with the plan. */
export interface CrossCheck {
  source: CrossSource;
  status: Agreement;
  text: string;
}

/** Everything the assistant already knows about the screen and its targets. */
export interface Knowledge {
  map: MappedElement[];
  familiar: FamiliarElement[];
  habits: Habit[];
  patterns: LearnedPattern[];
  /** The app/window the habits of this moment belong to. */
  context: string;
}

type Point = { x: number; y: number };

/** A learned point within this normalised distance of the plan agrees with it (3% of the screen). */
export const AGREE_DISTANCE = 0.03;

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const at = (p: Point) => `(${pct(p.x)}, ${pct(p.y)})`;
/** Whether two names share a meaningful word (either way). */
export const related = (a: string, b: string) => similarity(a, b) > 0 || similarity(b, a) > 0;
const status = (ok: boolean): Agreement => (ok ? 'consistent' : 'conflicting');

/** A remembered point compared with the plan: consistent within AGREE_DISTANCE. */
function distanceCheck(label: string, known: Point, p: Point): CrossCheck {
  const d = Math.hypot(known.x - p.x, known.y - p.y);
  return { source: 'learned', status: status(d <= AGREE_DISTANCE), text: `${label} at ${at(known)} is ${pct(d)} from the plan` };
}

/** The mapped element covering the planned point, and a mapped element named like the target that does not. */
function mappedChecks(target: string, p: Point, k: Knowledge): CrossCheck[] {
  const covering = mappedAt(k.map, p);
  const out: CrossCheck[] = [];
  if (covering) {
    const same = related(target, covering.name);
    out.push({ source: 'mapped', status: status(same), text: `Mapped element "${covering.name}" covers the planned point${same ? '' : `, not "${target}"`}` });
  }
  const named = k.map.find((e) => e !== covering && related(target, e.name) && !mappedAt([e], p));
  if (named) out.push({ source: 'mapped', status: 'conflicting', text: `Mapped element "${named.name}" is elsewhere — its boundary does not contain the planned point` });
  return out;
}

/** The habits recorded for this target in this context. */
export const habitsFor = (target: string, k: Knowledge) => k.habits.filter((h) => habitKey(h.target, h.context) === habitKey(target, k.context));

/** Last-known-good coordinates (familiar elements and habit anchors) against the plan. */
function learnedChecks(target: string, p: Point, k: Knowledge): CrossCheck[] {
  const familiar = findFamiliar(k.familiar, target);
  const out = familiar ? [distanceCheck(`Last-known-good "${familiar.name}" (seen ${familiar.timesSeen ?? 1}×)`, familiar, p)] : [];
  for (const h of habitsFor(target, k)) if (h.anchor) out.push(distanceCheck(`Habit anchor of "${h.target}"`, h.anchor, p));
  return out;
}

/** Success rate of every habit for this target; an unreliable one conflicts. */
function habitChecks(target: string, _p: Point, k: Knowledge): CrossCheck[] {
  return habitsFor(target, k).filter((h) => h.attempts > 0).map((h): CrossCheck => ({
    source: 'habit',
    status: status(isReliable(h)),
    text: `Habit "${h.target}"${h.context ? ` in ${h.context}` : ''}: ${h.successes}/${h.attempts} succeeded (${(successRate(h) * 100).toFixed(0)}%)`,
  }));
}

/** Learned avoid-patterns and habit avoid-lessons that match the target; a match always conflicts. */
function avoidChecks(target: string, _p: Point, k: Knowledge): CrossCheck[] {
  const learned = k.patterns.filter((pt) => pt.kind === 'avoid' && similarity(target, pt.pattern) > 0).map((pt) => `Learned avoid: ${pt.pattern}`);
  const lessons = habitsFor(target, k).flatMap((h) => h.lessons.filter((l) => l.kind === 'avoid').map((l) => `Habit avoid: ${l.text}`));
  return [...learned, ...lessons].map((text): CrossCheck => ({ source: 'avoid', status: 'conflicting', text }));
}

const CHECKS = [mappedChecks, learnedChecks, habitChecks, avoidChecks];

/** Every piece of known knowledge about `target` and whether it agrees with the planned point `p`. */
export const crossReference = (target: string, p: Point, k: Knowledge): CrossCheck[] => CHECKS.flatMap((check) => check(target, p, k));

/** Kinds whose agreement depends on where the plan points (a new point can resolve them). */
export const POINT_SOURCES: ReadonlySet<CrossSource> = new Set<CrossSource>(['mapped', 'learned']);

/** The entries that disagree with the plan. */
export const conflictsOf = (list: CrossCheck[]) => list.filter((c) => c.status === 'conflicting');
