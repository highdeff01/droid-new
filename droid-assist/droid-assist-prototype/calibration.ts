import type { Frame } from './types.js';
import type { RulerPoint } from './ruler.js';
import type { MappedElement } from './element-map.js';
import { matchTemplate, syncLevelFor } from './drift.js';

/** Grid the frame is split into for the cell-size reference (matches drift's diffCells grid). */
export const GRID_COLS = 16;
export const GRID_ROWS = 9;
/** Relative scale change that counts as drift (2%). */
export const SCALE_TOLERANCE = 0.02;
/** Anchor shift (share of the screen) that counts as drift. */
export const SHIFT_TOLERANCE = 0.01;
/** Wide search used to re-find reference elements on the live frame. */
const SEARCH = { radius: 64, stride: 2 };

/** A named reference point of the baseline. */
export interface RefPoint {
  name: string;
  x: number;
  y: number;
}

/** The known references recalibration re-measures: a mapped pair, the grid cell size, and the frame they were taken on. */
export interface Baseline {
  a: RefPoint | null;
  b: RefPoint | null;
  frame: Frame;
  /** Native pixel size of one grid cell when the baseline was set. */
  cellW: number;
  cellH: number;
  time: number;
}

/** The outcome of one recalibration: the per-axis transform from the old to the live layout. */
export interface Calibration {
  method: 'pair' | 'grid';
  /** Per-axis scale of normalized separations (pair) or of native pixels (grid). */
  scaleX: number;
  scaleY: number;
  /** The old anchor and where it is on the live frame (normalized). */
  from: RulerPoint;
  to: RulerPoint;
  resolutionChanged: boolean;
  drift: boolean;
  detail: string;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const dist = (p: RulerPoint, q: RulerPoint) => Math.hypot(p.x - q.x, p.y - q.y);

/** The two mapped elements farthest apart: the reference pair with the best scale resolution. */
export function widestPair(map: MappedElement[]): [MappedElement, MappedElement] | null {
  let best: [MappedElement, MappedElement] | null = null;
  let far = 0;
  map.forEach((p, i) => map.slice(i + 1).forEach((q) => {
    const d = dist(p, q);
    if (d > far) {
      far = d;
      best = [p, q];
    }
  }));
  return best;
}

/** A baseline from the live frame: the widest mapped pair (when there is one) plus the grid cell size. */
export function makeBaseline(frame: Frame, map: MappedElement[]): Baseline {
  const pair = widestPair(map);
  const ref = (e: MappedElement): RefPoint => ({ name: e.name, x: e.x, y: e.y });
  return { a: pair ? ref(pair[0]) : null, b: pair ? ref(pair[1]) : null, frame, cellW: frame.srcW / GRID_COLS, cellH: frame.srcH / GRID_ROWS, time: Date.now() };
}

/** Where a baseline reference is on the live frame, or null when it cannot be found. */
function relocate(base: Baseline, live: Frame, p: RefPoint): RulerPoint | null {
  const r = matchTemplate(base.frame.data, live.data, p.x, p.y, SEARCH);
  return syncLevelFor(r) === 'red' ? null : { x: clamp01(p.x + r.dx), y: clamp01(p.y + r.dy) };
}

/** Separation ratio on one axis; 1 when the pair is too close on that axis to measure it. */
const axisScale = (was: number, now: number) => (Math.abs(was) < 0.02 ? 1 : Math.abs(now) / Math.abs(was));
const off = (s: number) => Math.abs(s - 1) > SCALE_TOLERANCE;
const fmt = (s: number) => `×${s.toFixed(3)}`;

/** Re-measures the reference pair on the live frame; null when either element is lost. */
function pairCalibration(base: Baseline, live: Frame, resolutionChanged: boolean): Calibration | null {
  if (!base.a || !base.b) return null;
  const a = relocate(base, live, base.a);
  const b = relocate(base, live, base.b);
  if (!a || !b) return null;
  const scaleX = axisScale(base.b.x - base.a.x, b.x - a.x);
  const scaleY = axisScale(base.b.y - base.a.y, b.y - a.y);
  const shift = dist(base.a, a);
  const was = Math.round(Math.hypot((base.b.x - base.a.x) * base.frame.srcW, (base.b.y - base.a.y) * base.frame.srcH));
  const now = Math.round(Math.hypot((b.x - a.x) * live.srcW, (b.y - a.y) * live.srcH));
  const drift = off(scaleX) || off(scaleY) || shift > SHIFT_TOLERANCE || resolutionChanged;
  const detail = `"${base.a.name}" ↔ "${base.b.name}": ${was}px → ${now}px (scale ${fmt(scaleX)}, ${fmt(scaleY)}; anchor moved ${(shift * 100).toFixed(1)}%)`;
  return { method: 'pair', scaleX, scaleY, from: { x: base.a.x, y: base.a.y }, to: a, resolutionChanged, drift, detail };
}

/** Re-measures the grid cell size: detects a resolution change; normalized layout is assumed unchanged. */
function gridCalibration(base: Baseline, live: Frame, resolutionChanged: boolean): Calibration {
  const scaleX = live.srcW / GRID_COLS / base.cellW;
  const scaleY = live.srcH / GRID_ROWS / base.cellH;
  const detail = `grid cell ${Math.round(base.cellW)}×${Math.round(base.cellH)}px → ${Math.round(live.srcW / GRID_COLS)}×${Math.round(live.srcH / GRID_ROWS)}px (scale ${fmt(scaleX)}, ${fmt(scaleY)})`;
  return { method: 'grid', scaleX, scaleY, from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, resolutionChanged, drift: off(scaleX) || off(scaleY) || resolutionChanged, detail };
}

/**
 * Re-measures the baseline references against the live frame: the mapped pair when both are
 * found (layout scale and shift), otherwise the grid cell size (resolution scale only).
 */
export function recalibrate(base: Baseline, live: Frame): Calibration {
  const resolutionChanged = live.srcW !== base.frame.srcW || live.srcH !== base.frame.srcH;
  return pairCalibration(base, live, resolutionChanged) ?? gridCalibration(base, live, resolutionChanged);
}

/**
 * A stored normalized point in the live layout: a pair calibration scales it around the
 * anchor (and applies its shift); a grid calibration leaves normalized points as they are.
 * Always clamped to 0..1.
 */
export function remapPoint(cal: Calibration, p: RulerPoint): RulerPoint {
  if (cal.method === 'grid') return { x: clamp01(p.x), y: clamp01(p.y) };
  return { x: clamp01(cal.to.x + (p.x - cal.from.x) * cal.scaleX), y: clamp01(cal.to.y + (p.y - cal.from.y) * cal.scaleY) };
}
