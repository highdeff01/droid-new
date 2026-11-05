import { gridRef } from './grid.js';
import type { WorkflowStep } from './types.js';
import { MOBILITY_WINDOW, classifyMobility, predictNextPosition, type Sighting } from './mobility.js';

type Point = { x: number; y: number };

/** Within this normalized distance of the cursor the target is "close": the radar pulses instead of attracting. */
export const RADAR_NEAR = 0.08;
/** The largest normalized step one attract move takes toward a far target. */
export const ATTRACT_STEP = 0.1;
/** A target that moved less than this (normalized) between ticks counts as still. */
export const STILL_EPS = 0.004;
/** Ticks a close target must stay still before the adjusted move and the action. */
export const SETTLE_TICKS = 3;
/** The radar gives up on a target after this many ticks. */
export const RADAR_MAX_TICKS = 240;

/** A suggested or user-pointed element the radar steers onto, and the action to perform once on it. */
export interface RadarTarget {
  name: string;
  x: number;
  y: number;
  action: WorkflowStep['action'];
}

/** The tracker's memory between capture ticks. */
export interface RadarState {
  target: RadarTarget;
  ticks: number;
  stillTicks: number;
  /** Cursor-to-target distance in native pixels on the previous tick; null before the first. */
  lastDistancePx: number | null;
  /** Where the element was seen on recent ticks (oldest first, at most MOBILITY_WINDOW). */
  sightings: Sighting[];
}

/** What one tick decided. pulse: close, report; attract: far, slow approach; settle: close and still, move then act; expired: gave up. */
export type RadarEvent =
  | { kind: 'pulse'; distancePx: number; direction: string; moving: boolean; closing: boolean; predicted?: Point }
  | { kind: 'attract'; distancePx: number; direction: string; to: Point; closing: boolean; predicted?: Point }
  | { kind: 'settle'; distancePx: number; direction: string; to: Point; action: WorkflowStep['action'] }
  | { kind: 'expired'; distancePx: number; direction: string };

/** A fresh tracker for `target`. */
export const startRadar = (target: RadarTarget): RadarState => ({ target, ticks: 0, stillTicks: 0, lastDistancePx: null, sightings: [] });

/**
 * Where an in-motion element will be at the next capture: its velocity between the last two
 * sightings extrapolated by that same interval. Null while it is not in motion or has fewer than two sightings.
 */
export function predictedAim(sightings: Sighting[]): Point | null {
  if (classifyMobility(sightings).mobility !== 'in-motion') return null;
  const [a, b] = sightings.slice(-2);
  return predictNextPosition(sightings, (b.time - a.time) / 1000);
}

const COMPASS = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];

/** The screen direction from `from` to `to` in native pixels (8-way, screen y grows downward); "on target" at zero. */
export function direction(dxPx: number, dyPx: number): string {
  if (!dxPx && !dyPx) return 'on target';
  const sector = Math.round(Math.atan2(dyPx, dxPx) / (Math.PI / 4));
  return COMPASS[(sector + 8) % 8];
}

/** A point `step` (normalized) along the line from `from` toward `to`, never past it. */
export function approach(from: Point, to: Point, step = ATTRACT_STEP): Point {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (d <= step) return { x: to.x, y: to.y };
  const k = step / d;
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}

/**
 * One capture tick: `seen` is where the element is on the live frame now, `cursor` the pointer.
 * Close (<= RADAR_NEAR) pulses the live distance and direction until the element has been still
 * SETTLE_TICKS ticks, then settles (adjusted move onto it, then its action). Far attracts: one
 * slow ATTRACT_STEP move toward it. After RADAR_MAX_TICKS the radar expires. While the element is
 * in motion (by its recent sightings at `now`), pulses and attract steps aim at its predicted
 * position at the next capture instead of where it was last seen.
 */
export function radarTick(state: RadarState, cursor: Point, seen: Point, srcW: number, srcH: number, now = Date.now()): { state: RadarState; event: RadarEvent } {
  const moved = Math.hypot(seen.x - state.target.x, seen.y - state.target.y);
  const stillTicks = state.ticks > 0 && moved < STILL_EPS ? state.stillTicks + 1 : 0;
  const sightings = [...state.sightings, { x: seen.x, y: seen.y, time: now }].slice(-MOBILITY_WINDOW);
  const predicted = predictedAim(sightings);
  const aim = predicted ?? seen;
  const dxPx = Math.round((aim.x - cursor.x) * srcW);
  const dyPx = Math.round((aim.y - cursor.y) * srcH);
  const distancePx = Math.round(Math.hypot(dxPx, dyPx));
  const dir = direction(dxPx, dyPx);
  const closing = state.lastDistancePx === null || distancePx <= state.lastDistancePx;
  const lead = predicted ? { predicted } : {};
  const next: RadarState = { target: { ...state.target, x: seen.x, y: seen.y }, ticks: state.ticks + 1, stillTicks, lastDistancePx: distancePx, sightings };
  if (next.ticks > RADAR_MAX_TICKS) return { state: next, event: { kind: 'expired', distancePx, direction: dir } };
  if (Math.hypot(aim.x - cursor.x, aim.y - cursor.y) > RADAR_NEAR) return { state: next, event: { kind: 'attract', distancePx, direction: dir, to: approach(cursor, aim), closing, ...lead } };
  if (stillTicks >= SETTLE_TICKS) return { state: next, event: { kind: 'settle', distancePx, direction: dir, to: { x: seen.x, y: seen.y }, action: state.target.action } };
  return { state: next, event: { kind: 'pulse', distancePx, direction: dir, moving: stillTicks === 0, closing, ...lead } };
}

/** The four-part status the AI gets with every radar event. */
export interface RadarStatus {
  doing: string;
  could: string;
  wrong: string;
  next: string;
}

const MISTAKE = /prose|not a JSON|not identified|failed|error|below|refused|no template match/i;
const clip = (s: string) => (s.length > 120 ? `${s.slice(0, 120)}…` : s);

/** What the AI is doing wrong, from its own recent responses (newest first) and the distance trend. */
function wrongLine(event: RadarEvent, recent: string[]): string {
  const mistake = recent.find((r) => MISTAKE.test(r));
  if (mistake) return `your recent response "${clip(mistake)}" did not give a usable location`;
  if ('closing' in event && !event.closing) return `the distance grew to ${event.distancePx}px — the last move steered away from the target`;
  return 'nothing so far';
}

const DOING: Record<RadarEvent['kind'], (t: RadarTarget, e: RadarEvent) => string> = {
  pulse: (t, e) => `tracking "${t.name}" by radar: ${e.distancePx}px ${e.direction} of the cursor at ${gridRef(t)}${'moving' in e && e.moving ? ', still moving' : ''}`,
  attract: (t, e) => `approaching "${t.name}" slowly: ${e.distancePx}px ${e.direction}, at ${gridRef(t)}`,
  settle: (t) => `"${t.name}" stopped at ${gridRef(t)} — making the adjusted move onto it, then ${t.action}`,
  expired: (t) => `stopped tracking "${t.name}" — the radar ran out of ticks`,
};

const COULD: Record<RadarEvent['kind'], (t: RadarTarget) => string> = {
  pulse: (t) => `wait for "${t.name}" to stop, then move onto it and ${t.action}`,
  attract: (t) => `jump straight to ${gridRef(t)} if "${t.name}" is static`,
  settle: (t) => `re-identify "${t.name}" if the ${t.action} misses`,
  expired: (t) => `ask the user to point at "${t.name}" again`,
};

/** The better next action given the event and the latest response. */
function nextLine(t: RadarTarget, event: RadarEvent, latest: string | undefined): string {
  const after = latest ? ` (your last response: "${clip(latest)}")` : '';
  if (event.kind === 'settle') return `${t.action} at ${gridRef(t)} now${after}`;
  if (event.kind === 'expired') return `re-identify "${t.name}" with a JSON-only location reply${after}`;
  if (event.kind === 'attract') return `keep approaching ${event.direction}; answer location requests with JSON coordinates only${after}`;
  return `${event.moving ? 'steer' : 'hold'} ${event.direction} by ${event.distancePx}px until it stops moving${after}`;
}

/** The status of one radar event, built from the AI's recent responses (newest first). */
export function radarStatus(target: RadarTarget, event: RadarEvent, recent: string[]): RadarStatus {
  return { doing: DOING[event.kind](target, event), could: COULD[event.kind](target), wrong: wrongLine(event, recent), next: nextLine(target, event, recent[0]) };
}

/** The status as one timeline line. */
export const radarStatusText = (s: RadarStatus) => `Doing: ${s.doing} · Could be doing: ${s.could} · Doing wrong: ${s.wrong} · Better next: ${s.next}`;
