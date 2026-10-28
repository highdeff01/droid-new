import { COORD_MOVE_EPS } from './coords.js';
import { uid } from './planner.js';

type Point = { x: number; y: number };

/** Who moved a tracked element to a new position. */
export type Mover = 'user' | 'ai';

/** How a tracked element behaves over time. */
export type Motion = 'static' | 'moved-by-user' | 'moved-by-ai' | 'in-motion';

/** One stay at a position: when the element arrived there and, once it moved on, when it left. */
export interface Visit extends Point {
  since: number;
  until?: number;
}

/** A distinct position the element has been acted on at, with the actions tried and succeeded there. */
export interface Spot extends Point {
  attempts: number;
  successes: number;
}

/** A planned point against where the action actually had to land (from grounding/verification). */
export interface PositionTest {
  planned: Point;
  actual: Point;
  time: number;
}

/** A position set by the user or the AI that planning prefers over every learned one. */
export interface PreferredPosition extends Point {
  by: Mover;
}

/** Everything known about where one tracked element is, was, goes and works best. */
export interface PositionDossier {
  id: string;
  name: string;
  /** Stays at each position, oldest first; the last one is the current position. */
  visits: Visit[];
  spots: Spot[];
  /** Where the element is supposed to move to, when known. */
  move?: Point;
  preferred?: PreferredPosition;
  /** Planned vs actual landing points, newest first. */
  tests: PositionTest[];
  timesSeen: number;
  lastSeen: number;
  /** Position changes by each mover. */
  moves: Record<Mover, number>;
}

/** One sighting of a tracked element. */
export interface PositionObservation extends Point {
  name: string;
  time: number;
  by: Mover;
}

/** Most dossiers kept (least recently seen are pruned first). */
export const DOSSIER_LIMIT = 100;
/** Most visits kept per dossier. */
export const VISIT_LIMIT = 20;
/** Most spots kept per dossier. */
export const SPOT_LIMIT = 10;
/** Most planned-vs-actual tests kept per dossier. */
export const TEST_LIMIT = 20;
/** Moves needed before an element can count as always in motion. */
export const MOTION_MIN_MOVES = 4;
/** A median stay shorter than this (ms) makes an often-moved element always in motion. */
export const MOTION_MAX_DWELL_MS = 3000;
/** Attempts a spot needs before its success rate can make it the best position. */
export const BEST_MIN_ATTEMPTS = 2;

const key = (name: string) => name.trim().toLowerCase();
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) <= COORD_MOVE_EPS;
const point = (p: Point): Point => ({ x: clamp01(p.x), y: clamp01(p.y) });
const rate = (s: Spot) => (s.attempts ? s.successes / s.attempts : 0);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const at = (p: Point) => `(${pct(p.x)}, ${pct(p.y)})`;

/** The dossier of the element named `name` (case-insensitive), or null. */
export const findDossier = (list: PositionDossier[], name: string) => list.find((d) => key(d.name) === key(name)) ?? null;

/** Where the element is now (its latest visit). */
export const currentPosition = (d: PositionDossier): Point => d.visits[d.visits.length - 1];

/** Where the element was before it last moved; null when it never moved. */
export const previousPosition = (d: PositionDossier): Point | null => d.visits[d.visits.length - 2] ?? null;

const fresh = (name: string, p: Point, time: number): PositionDossier => ({
  id: uid('pos'), name: name.trim(), visits: [{ ...point(p), since: time }], spots: [], tests: [], timesSeen: 0, lastSeen: time, moves: { user: 0, ai: 0 },
});

/** Applies `change` to the dossier named `name` (created at `p` when missing) and puts it first. */
function upsert(list: PositionDossier[], name: string, p: Point, time: number, change: (d: PositionDossier) => PositionDossier): PositionDossier[] {
  if (!name.trim()) return list;
  const prev = findDossier(list, name);
  const next = change(prev ?? fresh(name, p, time));
  return [next, ...list.filter((d) => d !== prev)];
}

/** The visits after the element was seen at `p`: the current stay extended, or closed and a new one opened. */
function visitAt(visits: Visit[], p: Point, time: number): Visit[] {
  const last = visits[visits.length - 1];
  if (near(last, p)) return visits;
  return [...visits.slice(0, -1), { ...last, until: time }, { ...point(p), since: time }].slice(-VISIT_LIMIT);
}

/**
 * Records one sighting: the stay at the current position continues, or the element moved,
 * closing that stay, opening a new one and counting the move for its mover. A reached
 * move position is cleared.
 */
export function recordObservation(list: PositionDossier[], obs: PositionObservation): PositionDossier[] {
  return upsert(list, obs.name, obs, obs.time, (d) => {
    const moved = !near(currentPosition(d), obs);
    const move = d.move && near(d.move, obs) ? undefined : d.move;
    return {
      ...d,
      visits: visitAt(d.visits, obs, obs.time),
      move,
      timesSeen: d.timesSeen + 1,
      lastSeen: obs.time,
      moves: moved ? { ...d.moves, [obs.by]: d.moves[obs.by] + 1 } : d.moves,
    };
  });
}

/** The spots with one more attempt (and success) at `p`, added when no spot is there yet. */
function spotsAfter(spots: Spot[], p: Point, success: boolean): Spot[] {
  const hit = spots.find((s) => near(s, p)) ?? { ...point(p), attempts: 0, successes: 0 };
  const updated = { ...hit, attempts: hit.attempts + 1, successes: hit.successes + (success ? 1 : 0) };
  return [updated, ...spots.filter((s) => s !== hit)].slice(0, SPOT_LIMIT);
}

/** Records an action on the element at `p` and whether it succeeded. */
export function recordOutcome(list: PositionDossier[], name: string, p: Point, success: boolean, time: number): PositionDossier[] {
  return upsert(list, name, p, time, (d) => ({ ...d, spots: spotsAfter(d.spots, p, success), lastSeen: time }));
}

/** Records where an action was planned against where it actually had to land. */
export function recordTest(list: PositionDossier[], name: string, planned: Point, actual: Point, time: number): PositionDossier[] {
  const test = { planned: point(planned), actual: point(actual), time };
  return upsert(list, name, actual, time, (d) => ({ ...d, tests: [test, ...d.tests].slice(0, TEST_LIMIT), lastSeen: time }));
}

/** Sets (or with null clears) the user- or AI-preferred position of an existing element. */
export function setPreferred(list: PositionDossier[], name: string, p: PreferredPosition | null): PositionDossier[] {
  if (!findDossier(list, name)) return list;
  return upsert(list, name, p ?? { x: 0, y: 0 }, 0, (d) => ({ ...d, preferred: p ? { ...point(p), by: p.by } : undefined }));
}

/** Sets (or with null clears) where an existing element is supposed to move to. */
export function setMove(list: PositionDossier[], name: string, p: Point | null): PositionDossier[] {
  if (!findDossier(list, name)) return list;
  return upsert(list, name, p ?? { x: 0, y: 0 }, 0, (d) => ({ ...d, move: p ? point(p) : undefined }));
}

/** The spot with the highest success rate among those tried at least BEST_MIN_ATTEMPTS times; null with none. */
export function bestPosition(d: PositionDossier): Spot | null {
  const tried = d.spots.filter((s) => s.attempts >= BEST_MIN_ATTEMPTS);
  return tried.sort((a, b) => rate(b) - rate(a) || b.attempts - a.attempts)[0] ?? null;
}

/** The position that followed the current one the last time the element was there; null when unknown. */
function historicalNext(d: PositionDossier): Point | null {
  const now = currentPosition(d);
  for (let i = d.visits.length - 2; i >= 0; i--) {
    if (near(d.visits[i], now) && d.visits[i + 1] && i + 1 < d.visits.length - 1) return d.visits[i + 1];
  }
  return null;
}

/** Where the element moves next: its known move position, else what historically followed the current one. */
export const nextPosition = (d: PositionDossier): Point | null => d.move ?? historicalNext(d);

/** The median length (ms) of the element's finished stays; null when it never moved. */
export function medianDwell(d: PositionDossier): number | null {
  const stays = d.visits.filter((v) => v.until !== undefined).map((v) => v.until! - v.since).sort((a, b) => a - b);
  if (!stays.length) return null;
  const mid = Math.floor(stays.length / 2);
  return stays.length % 2 ? stays[mid] : (stays[mid - 1] + stays[mid]) / 2;
}

/** Static (never moved), always in motion (often and briefly), else moved mostly by the user or by the AI. */
export function classifyMotion(d: PositionDossier): Motion {
  const total = d.moves.user + d.moves.ai;
  if (!total) return 'static';
  const dwell = medianDwell(d);
  if (total >= MOTION_MIN_MOVES && dwell !== null && dwell < MOTION_MAX_DWELL_MS) return 'in-motion';
  return d.moves.ai > d.moves.user ? 'moved-by-ai' : 'moved-by-user';
}

/** The newest-seen DOSSIER_LIMIT dossiers. */
export const pruneDossiers = (list: PositionDossier[], limit = DOSSIER_LIMIT) => [...list].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, limit);

/** One-line summary of a dossier for the Memory panel and the AI context. */
export function dossierLine(d: PositionDossier): string {
  const best = bestPosition(d);
  const next = nextPosition(d);
  const prev = previousPosition(d);
  const parts = [
    `now ${at(currentPosition(d))}`,
    prev && `was ${at(prev)}`,
    next && `next ${at(next)}`,
    best && `best ${at(best)} (${best.successes}/${best.attempts})`,
    d.preferred && `preferred ${at(d.preferred)} by ${d.preferred.by}`,
  ].filter(Boolean);
  return `[Position] "${d.name}" ${classifyMotion(d)}, seen ${d.timesSeen}× — ${parts.join(', ')}`;
}
