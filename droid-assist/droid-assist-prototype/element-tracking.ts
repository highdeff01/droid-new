import type { Box } from './assist-ai.js';
import { iou } from './identify.js';
import { boxCenter, mapCell, MAP_LIMIT, type Appearance, type MappedElement, type MoveCause, type MoveEvent, type PositionRecord } from './element-map-studio.js';
import type { Detection } from './auto-scan.js';

/**
 * Element tracking: merges each auto-scan into the element map, keeps every position an element
 * was seen at (old ones stay as ghosts, with counts), attributes moves to the user, the AI or the
 * element itself, classifies motion and measures the timing of self-moving elements.
 */

/** Overlap (IoU) at which a detection is the same element at the same position. */
export const SAME_SPOT_IOU = 0.5;
/** Furthest (centre distance, screen fractions) a matching element may have travelled between scans. */
export const MOVE_RADIUS = 0.25;
/** Size tolerance (relative) for a moved element. */
const SIZE_TOLERANCE = 0.3;
/** Appearance tolerance for a moved element: mean luminance and edge share. */
const LUM_TOLERANCE = 24;
const EDGE_TOLERANCE = 0.1;
/** A user/AI action this long before a move, at the old or new spot, caused it. */
export const MOVE_BLAME_MS = 3000;
/** Margin around the old/new box an action may land in and still be blamed. */
const BLAME_PAD = 0.03;
/** Most positions kept per element (least-seen ghosts dropped first). */
export const POSITION_LIMIT = 8;
/** Most moves kept per element (oldest dropped first). */
export const MOVE_LIMIT = 50;
/** Self moves an element needs (and they must outnumber user/AI moves) to be always-in-motion. */
export const IN_MOTION_MOVES = 3;
/** Pause after a predicted move before acting, so the element has settled and a new frame shows it. */
export const SETTLE_MS = 600;

/** A user or AI input the engine saw, for blaming moves. */
export interface ActorInput {
  time: number;
  x: number;
  y: number;
  actor: 'user' | 'ai';
}

/** Static, moved by the user/AI (or occasionally by itself), or always in motion. */
export type MotionKind = 'static' | 'moved' | 'in_motion';

/** An element's motion label with its move counts by cause. */
export interface Motion {
  kind: MotionKind;
  user: number;
  ai: number;
  self: number;
}

/** Observed intervals between an element's own moves, their mean and spread, and when the next move is due. */
export interface MotionTiming {
  intervals: number[];
  meanMs: number;
  jitterMs: number;
  lastMoveAt: number;
  nextAt: number;
}

/** When to act on an element so it is caught where it is expected. */
export interface CatchPlan {
  waitMs: number;
  reason: string;
}

/** What one scan changed in the map. */
export interface ScanMerge {
  map: MappedElement[];
  added: number;
  seen: number;
  moved: Array<{ element: MappedElement; move: MoveEvent }>;
}

const pad = (b: Box, p: number): Box => ({ x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p });
const inside = (p: { x: number; y: number }, b: Box) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
const dist = (a: Box, b: Box) => Math.hypot(boxCenter(a).x - boxCenter(b).x, boxCenter(a).y - boxCenter(b).y);
const similarSize = (a: Box, b: Box) => Math.abs(a.w - b.w) <= SIZE_TOLERANCE * Math.max(a.w, b.w) && Math.abs(a.h - b.h) <= SIZE_TOLERANCE * Math.max(a.h, b.h);
const similarLook = (a: Appearance, b: Appearance) => Math.abs(a.lum - b.lum) <= LUM_TOLERANCE && Math.abs(a.edges - b.edges) <= EDGE_TOLERANCE;

/** Who moved an element from `from` to `to` at `time`: the latest user/AI input at either spot shortly before, else the element itself. */
export function moveCause(from: Box, to: Box, time: number, inputs: ActorInput[]): MoveCause {
  const hit = inputs
    .filter((a) => a.time <= time && time - a.time <= MOVE_BLAME_MS && (inside(a, pad(from, BLAME_PAD)) || inside(a, pad(to, BLAME_PAD))))
    .sort((a, b) => b.time - a.time)[0];
  return hit ? hit.actor : 'self';
}

/** Counts a sighting at `box`: the matching position's count goes up, else a new position is added (least-seen dropped past the limit). */
export function notePosition(positions: PositionRecord[], box: Box, now: number): PositionRecord[] {
  const i = positions.findIndex((p) => iou(p.box, box) >= SAME_SPOT_IOU);
  if (i >= 0) return positions.map((p, j) => (j === i ? { ...p, count: p.count + 1, lastSeen: now } : p));
  const next = [...positions, { box, count: 1, firstSeen: now, lastSeen: now }];
  if (next.length <= POSITION_LIMIT) return next;
  const drop = next.slice(0, -1).reduce((worst, p, j) => (p.count < next[worst].count || (p.count === next[worst].count && p.lastSeen < next[worst].lastSeen) ? j : worst), 0);
  return next.filter((_, j) => j !== drop);
}

/** The element seen again at its current spot. */
function seenHere(el: MappedElement, d: Detection, now: number): MappedElement {
  return { ...el, kind: el.kind ?? d.kind, appearance: d.appearance, timesSeen: (el.timesSeen ?? 0) + 1, lastSeen: now, positions: notePosition(el.positions ?? [{ box: el.box, count: 0, firstSeen: el.mappedAt, lastSeen: el.mappedAt }], el.box, now) };
}

/** The element seen at a new spot: its box follows, the old spot stays in `positions` as a ghost. */
function seenMoved(el: MappedElement, d: Detection, now: number, cause: MoveCause): { element: MappedElement; move: MoveEvent } {
  const move: MoveEvent = { time: now, cause, from: el.box, to: d.box };
  const base = el.positions ?? [{ box: el.box, count: el.timesSeen ?? 1, firstSeen: el.mappedAt, lastSeen: el.lastSeen ?? el.mappedAt }];
  const element: MappedElement = { ...el, box: d.box, appearance: d.appearance, timesSeen: (el.timesSeen ?? 0) + 1, lastSeen: now, positions: notePosition(base, d.box, now), moves: [...(el.moves ?? []), move].slice(-MOVE_LIMIT) };
  return { element, move };
}

/** A unique auto name: "<kind> at R<r>C<c>", suffixed when taken. */
function autoName(d: Detection, taken: Set<string>): string {
  const base = `${d.kind} at ${mapCell(boxCenter(d.box))}`;
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} #${n}`;
  taken.add(name.toLowerCase());
  return name;
}

/** A newly found element. */
function newElement(d: Detection, id: string, now: number, name: string): MappedElement {
  return { id, name, box: d.box, mappedAt: now, origin: 'auto', kind: d.kind, appearance: d.appearance, timesSeen: 1, lastSeen: now, positions: [{ box: d.box, count: 1, firstSeen: now, lastSeen: now }] };
}

/** The unmatched element `d` most plausibly is after moving: same kind, size and look, nearest within MOVE_RADIUS. */
function movedCandidate(map: MappedElement[], matched: Set<string>, d: Detection): number {
  let best = -1;
  let bestDist = MOVE_RADIUS;
  map.forEach((el, i) => {
    if (matched.has(el.id) || !el.appearance || el.kind !== d.kind || !similarSize(el.box, d.box) || !similarLook(el.appearance, d.appearance)) return;
    const dd = dist(el.box, d.box);
    if (dd <= bestDist) {
      best = i;
      bestDist = dd;
    }
  });
  return best;
}

/** Keeps at most MAP_LIMIT elements: user-drawn ones always, auto ones seen most recently. */
export function capMap(list: MappedElement[]): MappedElement[] {
  if (list.length <= MAP_LIMIT) return list;
  const autos = list.filter((e) => e.origin === 'auto').sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  const keep = new Set(autos.slice(0, Math.max(0, MAP_LIMIT - (list.length - autos.length))).map((e) => e.id));
  return list.filter((e) => e.origin !== 'auto' || keep.has(e.id));
}

/**
 * Merges one scan into the map: a detection on an element's current spot counts a sighting;
 * else one matching an unmatched element nearby (same kind, size, look) moves it — the old spot
 * stays as a ghost and the move is blamed on a recent user/AI input there or on the element
 * itself; else it is a new auto element. Elements not detected are kept as they are.
 */
export function mergeScan(map: MappedElement[], detections: Detection[], now: number, inputs: ActorInput[], newId: () => string): ScanMerge {
  const next = [...map];
  const matched = new Set<string>();
  const pending: Detection[] = [];
  let seen = 0;
  for (const d of detections) {
    const i = next.findIndex((el) => !matched.has(el.id) && iou(el.box, d.box) >= SAME_SPOT_IOU);
    if (i < 0) {
      pending.push(d);
      continue;
    }
    next[i] = seenHere(next[i], d, now);
    matched.add(next[i].id);
    seen++;
  }
  const moved: ScanMerge['moved'] = [];
  const fresh: Detection[] = [];
  for (const d of pending) {
    const i = movedCandidate(next, matched, d);
    if (i < 0) {
      fresh.push(d);
      continue;
    }
    const m = seenMoved(next[i], d, now, moveCause(next[i].box, d.box, now, inputs));
    next[i] = m.element;
    matched.add(m.element.id);
    moved.push(m);
  }
  const taken = new Set(next.map((e) => e.name.toLowerCase()));
  const added = fresh.map((d) => newElement(d, newId(), now, autoName(d, taken)));
  return { map: capMap([...next, ...added]), added: added.length, seen, moved };
}

/** Earlier positions of the element away from where it is now, with how often it was seen there. */
export const ghostPositions = (el: MappedElement): PositionRecord[] => (el.positions ?? []).filter((p) => iou(p.box, el.box) < SAME_SPOT_IOU);

/** Times the element was seen at its current spot. */
export const countHere = (el: MappedElement): number => (el.positions ?? []).find((p) => iou(p.box, el.box) >= SAME_SPOT_IOU)?.count ?? 0;

/** Static (never moved), always in motion (moves by itself, at least IN_MOTION_MOVES times and as often as user/AI moves), else moved. */
export function motionOf(el: MappedElement): Motion {
  const moves = el.moves ?? [];
  const count = (c: MoveCause) => moves.filter((m) => m.cause === c).length;
  const m = { user: count('user'), ai: count('ai'), self: count('self') };
  if (!moves.length) return { kind: 'static', ...m };
  return { kind: m.self >= IN_MOTION_MOVES && m.self >= m.user + m.ai ? 'in_motion' : 'moved', ...m };
}

/** Intervals between the element's own moves and the predicted next one; null with fewer than two self moves. */
export function motionTiming(el: MappedElement): MotionTiming | null {
  const times = (el.moves ?? []).filter((m) => m.cause === 'self').map((m) => m.time);
  if (times.length < 2) return null;
  const intervals = times.slice(1).map((t, i) => t - times[i]);
  const meanMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const jitterMs = Math.sqrt(intervals.reduce((a, b) => a + (b - meanMs) ** 2, 0) / intervals.length);
  const lastMoveAt = times[times.length - 1];
  return { intervals, meanMs, jitterMs, lastMoveAt, nextAt: lastMoveAt + meanMs };
}

/**
 * When to act on a moving element: during the first half of its usual rest it is caught now;
 * later it would likely move mid-action, so wait for the predicted move plus SETTLE_MS.
 */
export function catchPlan(timing: MotionTiming | null, now: number): CatchPlan {
  if (!timing || timing.meanMs <= 0) return { waitMs: 0, reason: 'no timing — act now' };
  const phase = (now - timing.lastMoveAt) % timing.meanMs;
  if (phase < timing.meanMs / 2) return { waitMs: 0, reason: `${Math.round(phase)} ms into a ~${Math.round(timing.meanMs)} ms rest — act now` };
  const waitMs = Math.round(timing.meanMs - phase + SETTLE_MS);
  return { waitMs, reason: `next move expected in ${Math.round(timing.meanMs - phase)} ms — wait ${waitMs} ms and catch it after it settles` };
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const at = (b: Box) => `${mapCell(boxCenter(b))} (${pct(boxCenter(b).x)}, ${pct(boxCenter(b).y)})`;

/** One tracking line for an element that moved or carries a perform function; null for a plain static element. */
export function trackingLine(el: MappedElement): string | null {
  const motion = motionOf(el);
  if (motion.kind === 'static' && !el.perform) return null;
  const parts = [`[Element tracking] "${el.name}" ${motion.kind.replace('_', ' ')} — now at ${at(el.box)} seen ${countHere(el)}×`];
  const ghosts = ghostPositions(el);
  if (ghosts.length) parts.push(`was at ${ghosts.map((g) => `${at(g.box)} ${g.count}×`).join(', ')}`);
  if (motion.kind !== 'static') parts.push(`moves: user ${motion.user}, AI ${motion.ai}, self ${motion.self}`);
  const timing = motionTiming(el);
  if (timing) parts.push(`moves every ~${Math.round(timing.meanMs)} ms (±${Math.round(timing.jitterMs)})`);
  if (el.perform) parts.push(`perform: ${el.perform.kind}${el.perform.text ? ` "${el.perform.text}"` : ''}`);
  return parts.join('; ');
}

/** The tracking lines of every moved or perform-carrying element, for planning context. */
export const trackingContext = (list: MappedElement[]): string[] => list.map(trackingLine).filter((l): l is string => l !== null);
