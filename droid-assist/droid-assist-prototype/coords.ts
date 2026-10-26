import type { FamiliarElement, Frame, TrailPoint } from './types.js';
import { MATCHED, matchTemplate } from './drift.js';
import { ANCHOR_PATCH, anchorPatch } from './habits.js';
import { rememberElement } from './elements.js';
import { uid } from './planner.js';

/** A coordinate change larger than this (normalized) between observations means the target moved. */
export const COORD_MOVE_EPS = 0.01;
/** The cursor resting this long counts as a dwell. */
export const DWELL_MS = 700;
/** The cursor staying within this distance (normalized) of where it rests counts as resting. */
export const DWELL_RADIUS = 0.015;
/** A dwell this close (normalized) to a learned target is an observation of that target. */
export const DWELL_NEAR = 0.04;
/** Live pointer points kept for dwell detection. */
export const POINTER_LIMIT = 200;
/** Search radii (sample pixels) for a learned target: near its learned point first, then wide. */
const NEAR_RADIUS = 24;
const WIDE_RADIUS = 64;

type Point = { x: number; y: number };

/** One sighting of a named target at a point, on a frame when one was captured. */
export interface CoordObservation {
  name: string;
  x: number;
  y: number;
  frame: Frame | null;
  time: number;
}

/** A target whose stored coordinates changed between observations. */
export interface CoordMove {
  name: string;
  from: Point;
  to: Point;
}

const key = (name: string) => name.trim().toLowerCase();
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** The remembered element named `name` (case-insensitive), or null. */
export const findFamiliar = (list: FamiliarElement[], name: string) => list.find((e) => key(e.name) === key(name)) ?? null;

/** Familiar elements the coordinate learner has observed at least once. */
export const learnedTargets = (list: FamiliarElement[]) => list.filter((e) => (e.timesSeen ?? 0) > 0);

/**
 * Records one observation in the familiar-elements memory: the entry with the same name is
 * updated in place (coordinates, time, frame, anchor patch, times seen + 1) or added. Reports
 * the move when the stored coordinates changed by more than COORD_MOVE_EPS.
 */
export function learnCoordinate(list: FamiliarElement[], obs: CoordObservation): { list: FamiliarElement[]; moved: CoordMove | null } {
  if (!obs.name.trim()) return { list, moved: null };
  const prev = findFamiliar(list, obs.name);
  const to = { x: clamp01(obs.x), y: clamp01(obs.y) };
  const anchor = obs.frame ? anchorPatch(obs.frame.data, to) : prev?.anchor;
  const entry: FamiliarElement = {
    ...prev,
    id: prev?.id ?? uid('el'),
    name: prev?.name ?? obs.name.trim(),
    ...to,
    lastSeen: obs.time,
    timesSeen: (prev?.timesSeen ?? 0) + 1,
    ...(obs.frame ? { frameId: obs.frame.id } : {}),
    ...(anchor ? { anchor } : {}),
  };
  const moved = prev && dist(prev, to) > COORD_MOVE_EPS + 1e-9 ? { name: entry.name, from: { x: prev.x, y: prev.y }, to } : null;
  return { list: rememberElement(list, entry), moved };
}

/** A stored luminance anchor as a small grayscale image with the patch centred, for matchTemplate. */
function anchorImage(anchor: number[]): ImageData {
  const w = ANCHOR_PATCH + 2;
  const data = new Uint8ClampedArray(w * w * 4);
  anchor.forEach((v, k) => {
    const i = ((1 + Math.floor(k / ANCHOR_PATCH)) * w + 1 + (k % ANCHOR_PATCH)) * 4;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  });
  return { data, width: w, height: w, colorSpace: 'srgb' } as ImageData;
}

/**
 * Where a learned target is on `live`: its anchor patch template-matched with the search window
 * seeded at `around` (its learned point by default), widened once when not found there.
 * Null when it has no anchor or nothing within MATCHED is found.
 */
export function learnedSeed(el: FamiliarElement, live: ImageData, around: Point = el): (Point & { distance: number }) | null {
  if (!el.anchor) return null;
  const ref = anchorImage(el.anchor);
  const c = (ANCHOR_PATCH + 2) >> 1;
  const search = (radius: number) => matchTemplate(ref, live, c / ref.width, c / ref.height, { size: ANCHOR_PATCH, radius, seed: around });
  let r = search(NEAR_RADIUS);
  if (r.matchDistance > MATCHED) r = search(WIDE_RADIUS);
  if (r.matchDistance > MATCHED) return null;
  return { x: clamp01(around.x + r.dx), y: clamp01(around.y + r.dy), distance: r.matchDistance };
}

/** The point where the cursor has rested for at least DWELL_MS, with when the rest began; null when it is moving. */
export function detectDwell(points: TrailPoint[], now: number): (Point & { since: number }) | null {
  const last = points[points.length - 1];
  if (!last) return null;
  let first = points.length - 1;
  while (first > 0 && dist(points[first - 1], last) <= DWELL_RADIUS) first--;
  const since = points[first].t;
  return now - since >= DWELL_MS ? { x: last.x, y: last.y, since } : null;
}

/**
 * A dwell over a learned target as an observation of it: the nearest target within DWELL_NEAR,
 * re-located on the frame by its anchor (at the dwell point when it has none). Null when the
 * cursor rests over no learned target or its anchor is not found.
 */
export function dwellObservation(list: FamiliarElement[], dwell: Point, frame: Frame, now: number): CoordObservation | null {
  const near = learnedTargets(list).filter((e) => dist(e, dwell) <= DWELL_NEAR).sort((a, b) => dist(a, dwell) - dist(b, dwell))[0];
  if (!near) return null;
  const at = near.anchor ? learnedSeed(near, frame.data, dwell) : dwell;
  return at ? { name: near.name, x: at.x, y: at.y, frame, time: now } : null;
}
