import type { Box } from './assist-ai.js';
import type { Appearance, ElementKind } from './element-map-studio.js';

/**
 * Auto-scan: finds every identifiable element (buttons, icons, text runs, inputs) on one frame's
 * 320x180 drift buffer — no model call. Edges (luminance gradients) are binned into a coarse
 * grid, joined into connected blobs, and each blob's box is classified by its shape and fill.
 */

/** Sample pixels per scan cell (the 320x180 buffer becomes an 80x45 grid). */
export const SCAN_CELL = 4;
/** Luminance step between neighbouring pixels that counts as an edge. */
export const EDGE_STEP = 28;
/** Share of a cell's pixels that must be edges for the cell to belong to an element. */
export const CELL_EDGE_SHARE = 0.08;
/** Most elements one scan returns (largest first). */
export const SCAN_LIMIT = 60;
/** A detected element box covering more than this share of the screen is a panel, not an element. */
const MAX_AREA = 0.25;
/** Fewest cells a blob needs. */
const MIN_CELLS = 2;

/** One element the auto-scan found. */
export interface Detection {
  box: Box;
  kind: ElementKind;
  appearance: Appearance;
}

const lumAt = (d: Uint8ClampedArray, i: number) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;

/** Per-pixel luminance of the buffer. */
function luminance(img: ImageData): Float32Array {
  const out = new Float32Array(img.width * img.height);
  for (let p = 0; p < out.length; p++) out[p] = lumAt(img.data, p * 4);
  return out;
}

/** Per-pixel edge flags: a big enough luminance step to the right or below neighbour. */
function edgeMap(lum: Float32Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const p = y * w + x;
      if (Math.abs(lum[p] - lum[p + 1]) >= EDGE_STEP || Math.abs(lum[p] - lum[p + w]) >= EDGE_STEP) out[p] = 1;
    }
  }
  return out;
}

/** The scan grid: 1 where a cell's edge share reaches CELL_EDGE_SHARE. */
function cellGrid(edges: Uint8Array, w: number, h: number): { cells: Uint8Array; cols: number; rows: number } {
  const cols = Math.floor(w / SCAN_CELL);
  const rows = Math.floor(h / SCAN_CELL);
  const cells = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let n = 0;
      for (let y = r * SCAN_CELL; y < (r + 1) * SCAN_CELL; y++) for (let x = c * SCAN_CELL; x < (c + 1) * SCAN_CELL; x++) n += edges[y * w + x];
      if (n / (SCAN_CELL * SCAN_CELL) >= CELL_EDGE_SHARE) cells[r * cols + c] = 1;
    }
  }
  return { cells, cols, rows };
}

/** Bounding boxes (in cells) of the 8-connected blobs of the grid. */
function blobs(cells: Uint8Array, cols: number, rows: number): Array<{ c0: number; r0: number; c1: number; r1: number; n: number }> {
  const seen = new Uint8Array(cells.length);
  const out: Array<{ c0: number; r0: number; c1: number; r1: number; n: number }> = [];
  for (let start = 0; start < cells.length; start++) {
    if (!cells[start] || seen[start]) continue;
    const b = { c0: cols, r0: rows, c1: -1, r1: -1, n: 0 };
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const c = i % cols;
      const r = Math.floor(i / cols);
      b.c0 = Math.min(b.c0, c);
      b.c1 = Math.max(b.c1, c);
      b.r0 = Math.min(b.r0, r);
      b.r1 = Math.max(b.r1, r);
      b.n++;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nc = c + dc;
          const nr = r + dr;
          const j = nr * cols + nc;
          if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && cells[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    out.push(b);
  }
  return out;
}

/** Mean luminance and edge share of a pixel rectangle. */
function appearanceOf(lum: Float32Array, edges: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number): Appearance {
  let sum = 0;
  let e = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      sum += lum[y * w + x];
      e += edges[y * w + x];
      n++;
    }
  }
  return { lum: n ? sum / n : 0, edges: n ? e / n : 0 };
}

/**
 * What a box looks like it is, from its shape (in screen fractions of a 16:9 frame) and fill:
 * a small square is an icon; a wide, short box is text when dense with edges, else an input
 * field (a mostly-empty outline); a moderately wide short box is a button; anything else a region.
 */
export function classify(box: Box, appearance: Appearance): ElementKind {
  const aspect = (box.w * 16) / (box.h * 9);
  if (box.w <= 0.06 && box.h <= 0.1 && aspect >= 0.6 && aspect <= 1.7) return 'icon';
  if (box.h <= 0.1 && aspect >= 4) return appearance.edges >= 0.18 ? 'text' : 'input';
  if (box.h <= 0.1 && aspect >= 1.3) return 'button';
  return 'region';
}

/** Every element the auto-scan finds on `img`, largest first, at most SCAN_LIMIT. */
export function scanElements(img: ImageData): Detection[] {
  const { width: w, height: h } = img;
  const lum = luminance(img);
  const edges = edgeMap(lum, w, h);
  const { cells, cols, rows } = cellGrid(edges, w, h);
  const out: Detection[] = [];
  for (const b of blobs(cells, cols, rows)) {
    if (b.n < MIN_CELLS) continue;
    const x0 = b.c0 * SCAN_CELL;
    const y0 = b.r0 * SCAN_CELL;
    const x1 = (b.c1 + 1) * SCAN_CELL;
    const y1 = (b.r1 + 1) * SCAN_CELL;
    const box: Box = { x: x0 / w, y: y0 / h, w: (x1 - x0) / w, h: (y1 - y0) / h };
    if (box.w * box.h > MAX_AREA) continue;
    const appearance = appearanceOf(lum, edges, w, x0, y0, x1, y1);
    out.push({ box, kind: classify(box, appearance), appearance });
  }
  return out.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h).slice(0, SCAN_LIMIT);
}
