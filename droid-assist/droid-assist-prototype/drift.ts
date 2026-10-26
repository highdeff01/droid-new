import type { SyncLevel } from './types.js';

/** Width/height of the downsampled buffers used for drift math. */
export const SAMPLE_W = 320;
export const SAMPLE_H = 180;

const lum = (d: Uint8ClampedArray, i: number) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;

/** A grayscale (luminance) copy of `img`, for matching templates that were stored as luminance. */
export function toGrayscale(img: ImageData): ImageData {
  const data = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = lum(img.data, i);
    data[i + 3] = img.data[i + 3];
  }
  return { width: img.width, height: img.height, data, colorSpace: 'srgb' } as ImageData;
}

/** Squared RGB difference of the pixels at byte offsets ia of `a` and ib of `b`. */
function rgbSquared(a: Uint8ClampedArray, ia: number, b: Uint8ClampedArray, ib: number): number {
  const dr = a[ia] - b[ib];
  const dg = a[ia + 1] - b[ib + 1];
  const db = a[ia + 2] - b[ib + 2];
  return dr * dr + dg * dg + db * db;
}

/** Whether a patch of half-width `half` centred on (x, y) lies inside `f`. */
const patchInside = (f: ImageData, x: number, y: number, half: number) => x - half >= 0 && y - half >= 0 && x + half < f.width && y + half < f.height;

/**
 * Normalized RMS colour (RGB) distance between the square patch of `size` around (ax, ay) in `a`
 * and the patch around (bx, by) in `b` sampled `scale` times as large (nearest neighbour).
 * @returns 0 (identical) .. 1 (black vs white), or null when a patch falls outside its frame.
 */
export function patchDistance(a: ImageData, ax: number, ay: number, b: ImageData, bx: number, by: number, size: number, scale = 1): number | null {
  const half = size >> 1;
  if (!patchInside(a, ax, ay, half) || !patchInside(b, bx, by, Math.ceil(half * scale))) return null;
  let sum = 0;
  let n = 0;
  for (let dy = -half; dy < half; dy++) {
    for (let dx = -half; dx < half; dx++) {
      const ia = ((ay + dy) * a.width + ax + dx) * 4;
      const ib = ((by + Math.round(dy * scale)) * b.width + bx + Math.round(dx * scale)) * 4;
      sum += rgbSquared(a.data, ia, b.data, ib);
      n++;
    }
  }
  return Math.sqrt(sum / (3 * n)) / 255;
}

/** Result of matching a reference template against a live frame. */
export interface DriftResult {
  /** Distance at the original location and size (0 = unchanged). */
  regionDistance: number;
  /** Distance at the best location and scale found in the search window. */
  matchDistance: number;
  /** Normalized offset of the best match — the drift to correct. */
  dx: number;
  dy: number;
  /** Size of the best match relative to the template (1 = same size). */
  scale: number;
}

/** Template scales tried by a search: same size first, so it wins ties, then smaller and larger. */
export const MATCH_SCALES: readonly number[] = [1, 0.75, 1.25];

/** Options of a template search. */
export interface MatchOptions {
  size?: number;
  /** Search radius in sample pixels (bigger = slower, catches larger drift). */
  radius?: number;
  stride?: number;
  /** Normalized point of `live` the search window is centred on (a learned coordinate); defaults to (nx, ny). */
  seed?: { x: number; y: number };
  /** Scales of the live target relative to the template that are searched; defaults to MATCH_SCALES. */
  scales?: readonly number[];
}

/** Sample-pixel position of a normalized coordinate, kept far enough inside for a patch. */
const inner = (n: number, len: number, half: number) => Math.min(len - half - 1, Math.max(half, Math.round(n * len)));

interface Candidate {
  d: number;
  dx: number;
  dy: number;
  scale: number;
}

/** A template patch at (x, y) of `ref` and the window of `live` around (cx, cy) it is searched in. */
interface SearchWindow {
  ref: ImageData;
  x: number;
  y: number;
  live: ImageData;
  cx: number;
  cy: number;
  size: number;
  radius: number;
  stride: number;
}

/** The best (strictly closer than `best`) position of the template in the window at one scale. */
function searchAtScale(w: SearchWindow, scale: number, best: Candidate): Candidate {
  let out = best;
  for (let dy = -w.radius; dy <= w.radius; dy += w.stride) {
    for (let dx = -w.radius; dx <= w.radius; dx += w.stride) {
      const d = patchDistance(w.ref, w.x, w.y, w.live, w.cx + dx, w.cy + dy, w.size, scale);
      if (d !== null && d < out.d) out = { d, dx, dy, scale };
    }
  }
  return out;
}

/**
 * Finds where the patch around (nx, ny) in `ref` moved to in `live`, searching a window
 * centred on `seed` (a learned coordinate) or, without one, on the same spot, at each scale
 * (a target that grew, shrank, or a capture whose resolution changed still matches).
 * dx/dy are the normalized offset of the best match from the window centre.
 */
export function matchTemplate(ref: ImageData, live: ImageData, nx: number, ny: number, { size = 16, radius = 24, stride = 2, seed, scales = MATCH_SCALES }: MatchOptions = {}): DriftResult {
  const half = size >> 1;
  const x = inner(nx, ref.width, half);
  const y = inner(ny, ref.height, half);
  const cx = seed ? inner(seed.x, live.width, half) : x;
  const cy = seed ? inner(seed.y, live.height, half) : y;
  const region = patchDistance(ref, x, y, live, cx, cy, size) ?? 1;
  let best: Candidate = { d: region, dx: 0, dy: 0, scale: 1 };
  if (region > 0.02) {
    const window: SearchWindow = { ref, x, y, live, cx, cy, size, radius, stride };
    for (const scale of scales) best = searchAtScale(window, scale, best);
  }
  return { regionDistance: region, matchDistance: best.d, dx: best.dx / live.width, dy: best.dy / live.height, scale: best.scale };
}

/** Default thresholds for the green/yellow/red sync indicator. */
export const STABLE = 0.05;
export const MATCHED = 0.1;
/** Default search radius of drift verification, in sample pixels. */
export const SEARCH_RADIUS = 24;
/** How much wider than the normal radius the fallback search of a changed UI is (64px at the default). */
const WIDE_FACTOR = 64 / SEARCH_RADIUS;

/** The user-tunable drift thresholds (Settings). */
export interface DriftThresholds {
  /** Distance at the original spot up to which a target counts as unchanged (green). */
  stable: number;
  /** Best-match distance up to which a moved target counts as found (yellow). */
  matched: number;
  /** Search radius in sample pixels. */
  radius: number;
}

export const DEFAULT_DRIFT: DriftThresholds = { stable: STABLE, matched: MATCHED, radius: SEARCH_RADIUS };

/** Green = target unchanged, yellow = moved but found (correctable), red = not found. */
export function syncLevelFor(r: DriftResult, t: DriftThresholds = DEFAULT_DRIFT): SyncLevel {
  if (r.regionDistance <= t.stable) return 'green';
  if (r.matchDistance <= t.matched) return 'yellow';
  return 'red';
}

/** A step target verified on the live frame, with the correction to apply. */
export interface DriftCorrection {
  level: SyncLevel;
  /** Corrected normalized target (the original when nothing moved or nothing matched). */
  x: number;
  y: number;
  /** Measured drift in native screen pixels. */
  dxPx: number;
  dyPx: number;
  driftPx: number;
  regionDistance: number;
  matchDistance: number;
  /** True when the UI changed so much that the wide search window was needed. */
  widened: boolean;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Verifies a step's target on the live frame and computes where it moved to.
 * The template is searched near its recorded spot; when it is not found there and the
 * UI changed (diffCells), a wider window is searched before giving up ('red').
 * @param srcW native screen width, for reporting drift in pixels
 * @param t thresholds and search radius (Settings); the defaults when omitted
 */
export function correctDrift(ref: ImageData, live: ImageData, nx: number, ny: number, srcW: number, srcH: number, t: DriftThresholds = DEFAULT_DRIFT): DriftCorrection {
  let r = matchTemplate(ref, live, nx, ny, { radius: t.radius });
  let widened = false;
  if (syncLevelFor(r, t) === 'red' && diffCells(ref, live).length > 0) {
    const wide = matchTemplate(ref, live, nx, ny, { radius: Math.round(t.radius * WIDE_FACTOR), stride: 2 });
    if (wide.matchDistance < r.matchDistance) {
      r = wide;
      widened = true;
    }
  }
  const level = syncLevelFor(r, t);
  const moved = level === 'red' ? { dx: 0, dy: 0 } : r;
  const dxPx = Math.round(moved.dx * srcW);
  const dyPx = Math.round(moved.dy * srcH);
  return {
    level,
    x: clamp01(nx + moved.dx),
    y: clamp01(ny + moved.dy),
    dxPx,
    dyPx,
    driftPx: Math.round(Math.hypot(dxPx, dyPx)),
    regionDistance: r.regionDistance,
    matchDistance: r.matchDistance,
    widened,
  };
}

/** What changed on screen after an action was executed. */
export interface Reverify {
  /** Distance around the target between the before and after frames. */
  targetChange: number;
  /** Whole-frame distance between the before and after frames. */
  frameChange: number;
  /** True when the action visibly changed the screen. */
  changed: boolean;
}

/** Re-verifies an executed action: compares the frame before and after around (nx, ny) and overall. */
export function reverify(before: ImageData, after: ImageData, nx: number, ny: number): Reverify {
  const box = { x: clamp01(nx - 0.08), y: clamp01(ny - 0.08), w: 0.16, h: 0.16 };
  const targetChange = boxDistance(before, after, box);
  const frameChange = frameDistance(before, after);
  return { targetChange, frameChange, changed: targetChange > 0.02 || frameChange > 0.01 };
}

/** A grid cell whose pixels changed between two frames. */
export interface ChangedCell {
  col: number;
  row: number;
  distance: number;
}

/** Splits two frames into a grid and returns the cells that drifted beyond `threshold`. */
export function diffCells(a: ImageData, b: ImageData, cols = 16, rows = 9, threshold = 0.1): ChangedCell[] {
  const cw = Math.floor(a.width / cols);
  const ch = Math.floor(a.height / rows);
  const out: ChangedCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let sum = 0;
      let n = 0;
      for (let y = row * ch; y < (row + 1) * ch; y += 2) {
        for (let x = col * cw; x < (col + 1) * cw; x += 2) {
          const i = (y * a.width + x) * 4;
          const d = lum(a.data, i) - lum(b.data, i);
          sum += d * d;
          n++;
        }
      }
      const distance = Math.sqrt(sum / n) / 255;
      if (distance > threshold) out.push({ col, row, distance });
    }
  }
  return out;
}

/**
 * The largest 4-connected group of changed cells. Isolated changes (a ticking clock,
 * a blinking caret) are dropped so a popup is not merged with unrelated noise.
 */
export function largestCluster(cells: ChangedCell[]): ChangedCell[] {
  const key = (c: number, r: number) => `${c}:${r}`;
  const byKey = new Map(cells.map((c) => [key(c.col, c.row), c]));
  const seen = new Set<string>();
  let best: ChangedCell[] = [];
  for (const cell of cells) {
    const k = key(cell.col, cell.row);
    if (seen.has(k)) continue;
    const group: ChangedCell[] = [];
    const stack = [cell];
    seen.add(k);
    while (stack.length) {
      const cur = stack.pop()!;
      group.push(cur);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = key(cur.col + dc, cur.row + dr);
        const next = byKey.get(nk);
        if (next && !seen.has(nk)) {
          seen.add(nk);
          stack.push(next);
        }
      }
    }
    if (group.length > best.length) best = group;
  }
  return best;
}

/** Normalized distance between two frames inside a normalized box (0 = identical). */
export function boxDistance(a: ImageData, b: ImageData, box: { x: number; y: number; w: number; h: number }): number {
  const x0 = Math.floor(box.x * a.width);
  const x1 = Math.min(a.width, Math.ceil((box.x + box.w) * a.width));
  const y0 = Math.floor(box.y * a.height);
  const y1 = Math.min(a.height, Math.ceil((box.y + box.h) * a.height));
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * a.width + x) * 4;
      const d = lum(a.data, i) - lum(b.data, i);
      sum += d * d;
      n++;
    }
  }
  return n ? Math.sqrt(sum / n) / 255 : 0;
}

/** Whole-frame distance at low resolution. */
export function frameDistance(a: ImageData, b: ImageData): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4 * 7) {
    const d = lum(a.data, i) - lum(b.data, i);
    sum += d * d;
    n++;
  }
  return Math.sqrt(sum / n) / 255;
}

/** Normalized bounding box of a set of changed cells, or null when empty. */
export function boundingBox(cells: ChangedCell[], cols = 16, rows = 9) {
  if (!cells.length) return null;
  const minC = Math.min(...cells.map((c) => c.col));
  const maxC = Math.max(...cells.map((c) => c.col));
  const minR = Math.min(...cells.map((c) => c.row));
  const maxR = Math.max(...cells.map((c) => c.row));
  return { x: minC / cols, y: minR / rows, w: (maxC - minC + 1) / cols, h: (maxR - minR + 1) / rows };
}
