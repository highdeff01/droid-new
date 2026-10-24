import type { SyncLevel } from './types.js';

/** Width/height of the downsampled buffers used for drift math. */
export const SAMPLE_W = 320;
export const SAMPLE_H = 180;

const lum = (d: Uint8ClampedArray, i: number) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;

/**
 * Normalized Euclidean (RMS) distance between two square patches.
 * @returns 0 (identical) .. 1, or null when a patch falls outside its frame.
 */
export function patchDistance(a: ImageData, ax: number, ay: number, b: ImageData, bx: number, by: number, size: number): number | null {
  const half = size >> 1;
  const inside = (f: ImageData, x: number, y: number) => x - half >= 0 && y - half >= 0 && x + half < f.width && y + half < f.height;
  if (!inside(a, ax, ay) || !inside(b, bx, by)) return null;
  let sum = 0;
  let n = 0;
  for (let dy = -half; dy < half; dy++) {
    for (let dx = -half; dx < half; dx++) {
      const ia = ((ay + dy) * a.width + ax + dx) * 4;
      const ib = ((by + dy) * b.width + bx + dx) * 4;
      const diff = lum(a.data, ia) - lum(b.data, ib);
      sum += diff * diff;
      n++;
    }
  }
  return Math.sqrt(sum / n) / 255;
}

/** Result of matching a reference template against a live frame. */
export interface DriftResult {
  /** Distance at the original location (0 = unchanged). */
  regionDistance: number;
  /** Distance at the best location found in the search window. */
  matchDistance: number;
  /** Normalized offset of the best match — the drift to correct. */
  dx: number;
  dy: number;
}

/**
 * Finds where the patch around (nx, ny) in `ref` moved to in `live`.
 * @param radius search radius in sample pixels (bigger = slower, catches larger drift)
 */
export function matchTemplate(ref: ImageData, live: ImageData, nx: number, ny: number, { size = 16, radius = 24, stride = 2 } = {}): DriftResult {
  const half = size >> 1;
  const x = Math.min(ref.width - half - 1, Math.max(half, Math.round(nx * ref.width)));
  const y = Math.min(ref.height - half - 1, Math.max(half, Math.round(ny * ref.height)));
  const region = patchDistance(ref, x, y, live, x, y, size) ?? 1;
  let best = { d: region, dx: 0, dy: 0 };
  if (region > 0.02) {
    for (let dy = -radius; dy <= radius; dy += stride) {
      for (let dx = -radius; dx <= radius; dx += stride) {
        const d = patchDistance(ref, x, y, live, x + dx, y + dy, size);
        if (d !== null && d < best.d) best = { d, dx, dy };
      }
    }
  }
  return { regionDistance: region, matchDistance: best.d, dx: best.dx / ref.width, dy: best.dy / ref.height };
}

/** Thresholds for the green/yellow/red sync indicator. */
export const STABLE = 0.05;
export const MATCHED = 0.1;

/** Green = target unchanged, yellow = moved but found (correctable), red = not found. */
export function syncLevelFor(r: DriftResult): SyncLevel {
  if (r.regionDistance <= STABLE) return 'green';
  if (r.matchDistance <= MATCHED) return 'yellow';
  return 'red';
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
