import type { WorkflowStep } from './types.js';
import { AGREE_DISTANCE } from './cross-reference.js';
import { bestPosition, classifyMotion, currentPosition, medianDwell, nextPosition, type PositionDossier, type PositionTest } from './position-dossier.js';

type Point = { x: number; y: number };

/** How the dossier changed a step's point and timing. */
export interface Compensation {
  point: Point;
  /** Wait before acting, to catch an in-motion element at its next position (ms). */
  waitMs: number;
  /** The systematic test-vs-actual offset applied to the point, when one was. */
  offset: Point | null;
  /** One line per adjustment, for the log. */
  notes: string[];
}

/** Recent tests the systematic offset is measured over. */
export const OFFSET_WINDOW = 5;
/** Tests needed before an offset counts as systematic. */
export const OFFSET_MIN_TESTS = 3;
/** A mean offset smaller than this (normalized) is noise. */
export const OFFSET_MIN = 0.005;
/** Longest catch wait for an in-motion element (ms). */
export const CATCH_MAX_MS = 5000;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const at = (p: Point) => `(${pct(p.x)}, ${pct(p.y)})`;

/**
 * The mean actual − planned offset of the recent tests when it is systematic: at least
 * OFFSET_MIN_TESTS tests, a mean larger than OFFSET_MIN and a spread under half the mean.
 */
export function systematicOffset(tests: PositionTest[]): Point | null {
  const deltas = tests.slice(0, OFFSET_WINDOW).map((t) => ({ x: t.actual.x - t.planned.x, y: t.actual.y - t.planned.y }));
  if (deltas.length < OFFSET_MIN_TESTS) return null;
  const mean = { x: deltas.reduce((s, d) => s + d.x, 0) / deltas.length, y: deltas.reduce((s, d) => s + d.y, 0) / deltas.length };
  const size = Math.hypot(mean.x, mean.y);
  const spread = deltas.reduce((s, d) => s + dist(d, mean), 0) / deltas.length;
  return size > OFFSET_MIN && spread < size / 2 ? mean : null;
}

/** The position planning prefers over `p`: the preferred one, else the predicted next of an in-motion element, else a best one that `p` is not already at. */
function preferredPoint(d: PositionDossier, p: Point): { point: Point; note: string } | null {
  if (d.preferred) return { point: d.preferred, note: `preferred position ${at(d.preferred)} (set by ${d.preferred.by})` };
  const next = classifyMotion(d) === 'in-motion' ? nextPosition(d) : null;
  if (next) return { point: next, note: `in motion — aiming at its predicted next position ${at(next)}` };
  const best = bestPosition(d);
  if (best && dist(best, p) > AGREE_DISTANCE) return { point: best, note: `best position ${at(best)} (${best.successes}/${best.attempts} succeeded)` };
  return null;
}

/** For an in-motion element: the rest of its median stay at the current position, capped at CATCH_MAX_MS. */
export function catchWait(d: PositionDossier, now: number): number {
  const dwell = medianDwell(d);
  if (classifyMotion(d) !== 'in-motion' || dwell === null) return 0;
  const since = d.visits[d.visits.length - 1].since;
  return Math.min(CATCH_MAX_MS, Math.max(0, dwell - (now - since)));
}

/**
 * Factors the element's dossier into the point `p` a step was about to act at: prefer the
 * preferred/predicted/best position, wait to catch an in-motion element, and apply a
 * systematic test-vs-actual offset at most once per step (`applied` holds the step ids already corrected).
 */
export function compensate(d: PositionDossier | null, step: WorkflowStep, p: Point, applied: ReadonlySet<string>, now: number): Compensation {
  if (!d) return { point: p, waitMs: 0, offset: null, notes: [] };
  const chosen = preferredPoint(d, p);
  const base = chosen?.point ?? p;
  const measured = applied.has(step.id) ? null : systematicOffset(d.tests);
  const point = measured ? { x: clamp01(base.x + measured.x), y: clamp01(base.y + measured.y) } : base;
  const waitMs = catchWait(d, now);
  const notes = [
    chosen?.note,
    measured && `systematic offset (${pct(measured.x)}, ${pct(measured.y)}) applied once`,
    waitMs && `waiting ${(waitMs / 1000).toFixed(1)} s to catch it`,
  ].filter((n): n is string => !!n);
  return { point, waitMs, offset: measured, notes };
}

/** The last-known position drift search starts from; null without a dossier. */
export const seedPoint = (d: PositionDossier | null): Point | null => (d ? currentPosition(d) : null);
