import { boxCenter, type MappedElement } from './element-map-studio.js';

/**
 * Mobility from position history: how fast an element travels and where a moving element is
 * heading. Positions are screen fractions (0..1), times in ms.
 */

/** One place an element was seen, and when. */
export interface Sighting {
  x: number;
  y: number;
  time: number;
}

/** Never moved, moved now and then (by the user), or continuously moving. */
export type Mobility = 'static' | 'user-moved' | 'in-motion';

/** Sightings considered when classifying mobility (the most recent ones). */
export const MOBILITY_WINDOW = 5;
/** Above this speed (screen fractions per second) an element is in motion. */
export const IN_MOTION_SPEED = 0.05;
/** Total travel (screen fractions) over the window above which a slow element was moved. */
export const MOVED_DISTANCE = 0.02;
/** Shortest span (s) speed is measured over, so two near-simultaneous sightings do not read as a jump. */
const MIN_SPAN_SEC = 0.1;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Static, user-moved or in-motion from the last MOBILITY_WINDOW sightings, with the speed travelled (fractions/s). */
export function classifyMobility(history: Sighting[]): { mobility: Mobility; speed: number } {
  if (history.length < 2) return { mobility: 'static', speed: 0 };
  const recent = history.slice(-MOBILITY_WINDOW);
  const travelled = recent.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - recent[i].x, p.y - recent[i].y), 0);
  const spanSec = Math.max(MIN_SPAN_SEC, (recent[recent.length - 1].time - recent[0].time) / 1000);
  const speed = travelled / spanSec;
  if (speed > IN_MOTION_SPEED) return { mobility: 'in-motion', speed };
  if (travelled > MOVED_DISTANCE) return { mobility: 'user-moved', speed };
  return { mobility: 'static', speed: 0 };
}

/**
 * Where a moving element will be `leadSeconds` after its last sighting, extrapolating the velocity
 * between its last two sightings; clamped to the screen. Null with fewer than two sightings or
 * when the last two are not in time order.
 */
export function predictNextPosition(history: Sighting[], leadSeconds = 1): { x: number; y: number } | null {
  if (history.length < 2) return null;
  const p1 = history[history.length - 2];
  const p2 = history[history.length - 1];
  const dt = (p2.time - p1.time) / 1000;
  if (dt <= 0) return null;
  return { x: clamp01(p2.x + ((p2.x - p1.x) / dt) * leadSeconds), y: clamp01(p2.y + ((p2.y - p1.y) / dt) * leadSeconds) };
}

/** Where a mapped element landed after each of its own (self) moves, oldest first. */
export const selfMoveSightings = (el: MappedElement): Sighting[] => (el.moves ?? []).filter((m) => m.cause === 'self').map((m) => ({ ...boxCenter(m.to), time: m.time }));
