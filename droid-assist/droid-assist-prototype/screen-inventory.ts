import type { FamiliarElement, Frame } from './types.js';
import type { Box } from './assist-ai.js';
import { boxDistance } from './drift.js';
import { cellAt, cellLabel } from './grid.js';
import { boxCenter, mapCells, type MappedElement } from './element-map-studio.js';
import { similarity } from './planner.js';

/** What a detected element looks like it is. */
export type ElementKind = 'button' | 'input' | 'text' | 'panel' | 'tab';

/** How an element behaved since the previous reading: unchanged, sits elsewhere, or its pixels are changing. */
export type ElementState = 'static' | 'moved' | 'in-motion';

/** One detected element of the full-screen reading. Box is normalized 0..1. */
export interface InventoryElement {
  id: string;
  /** Label guess: a mapped or familiar element's name, else the kind and grid cell. */
  name: string;
  /** True when the name came from memory (mapped / familiar), not a guess. */
  known: boolean;
  kind: ElementKind;
  box: Box;
  /** Planner-grid cell of the centre (A1..H12). */
  cell: string;
  /** Element-map cells the box spans (R1C1..R16C24). */
  mapCells: string;
  state: ElementState;
}

/** What a reading is built from besides the frame. */
export interface InventoryInput {
  frame: Frame | null;
  mapped?: MappedElement[];
  familiar?: FamiliarElement[];
  /** The previous reading and its frame, for the moved / in-motion classification. */
  prev?: InventoryElement[];
  prevFrame?: Frame | null;
}

/** Segmentation cells across / down the 320x180 drift buffer (10x10 sample pixels each). */
export const CELL_COLS = 32;
export const CELL_ROWS = 18;
/** Luminance contrast (0..1) against the background, or inner variation, that makes a cell foreground. */
export const CELL_CONTRAST = 0.12;
/** Box distance between the previous and current frame above which an element is in motion. */
export const MOTION_THRESHOLD = 0.1;
/** Centre offset (fraction of the screen) above which a same-named element counts as moved. */
export const MOVE_THRESHOLD = 0.02;
/** Most elements one reading keeps (largest first). */
export const INVENTORY_LIMIT = 60;

const lum = (d: Uint8ClampedArray, i: number) => (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
const key = (name: string) => name.trim().toLowerCase();
/** The bare planner-grid cell (A1..H12) of a box's centre. */
const cellOf = (b: Box) => cellLabel(cellAt(boxCenter(b)));

/** Mean luminance and its spread of one segmentation cell. */
function cellStats(img: ImageData, col: number, row: number): { mean: number; spread: number } {
  const cw = img.width / CELL_COLS;
  const ch = img.height / CELL_ROWS;
  let sum = 0;
  let min = 1;
  let max = 0;
  let n = 0;
  for (let y = Math.floor(row * ch); y < Math.floor((row + 1) * ch); y++) {
    for (let x = Math.floor(col * cw); x < Math.floor((col + 1) * cw); x++) {
      const v = lum(img.data, (y * img.width + x) * 4);
      sum += v;
      min = Math.min(min, v);
      max = Math.max(max, v);
      n++;
    }
  }
  return { mean: n ? sum / n : 0, spread: n ? max - min : 0 };
}

/** The median of `values`. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1] ?? 0;
}

/** Foreground mask of the cell grid: cells that stand out from the background or carry inner edges. */
export function foregroundCells(img: ImageData): boolean[] {
  const stats: { mean: number; spread: number }[] = [];
  for (let row = 0; row < CELL_ROWS; row++) for (let col = 0; col < CELL_COLS; col++) stats.push(cellStats(img, col, row));
  const bg = median(stats.map((s) => s.mean));
  return stats.map((s) => Math.abs(s.mean - bg) > CELL_CONTRAST || s.spread > CELL_CONTRAST * 2);
}

/** Normalized boxes of the 4-connected groups of foreground cells, largest first. */
export function segmentRegions(mask: boolean[]): Box[] {
  const seen = new Set<number>();
  const out: { box: Box; size: number }[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    let [minC, maxC, minR, maxR, size] = [CELL_COLS, 0, CELL_ROWS, 0, 0];
    while (stack.length) {
      const i = stack.pop()!;
      const col = i % CELL_COLS;
      const row = Math.floor(i / CELL_COLS);
      [minC, maxC, minR, maxR, size] = [Math.min(minC, col), Math.max(maxC, col), Math.min(minR, row), Math.max(maxR, row), size + 1];
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = col + dc;
        const r = row + dr;
        const j = r * CELL_COLS + c;
        if (c < 0 || c >= CELL_COLS || r < 0 || r >= CELL_ROWS || !mask[j] || seen.has(j)) continue;
        seen.add(j);
        stack.push(j);
      }
    }
    out.push({ box: { x: minC / CELL_COLS, y: minR / CELL_ROWS, w: (maxC - minC + 1) / CELL_COLS, h: (maxR - minR + 1) / CELL_ROWS }, size });
  }
  return out.sort((a, b) => b.size - a.size).map((r) => r.box);
}

/** Kind rules, first match wins; a box matching none is a button. */
const KIND_RULES: { kind: ElementKind; test: (b: Box) => boolean }[] = [
  { kind: 'panel', test: (b) => b.w * b.h >= 0.08 },
  { kind: 'tab', test: (b) => b.y < 0.12 && b.h <= 0.12 && b.w <= 0.25 },
  { kind: 'input', test: (b) => b.w / b.h >= 6 && b.h <= 0.12 },
  { kind: 'text', test: (b) => b.w / b.h >= 3 && b.h <= 0.12 },
];

/** The kind a box looks like from its size, shape and position (screen aspect 16:9 is applied). */
export function guessKind(b: Box): ElementKind {
  const shaped = { ...b, w: b.w * (16 / 9) };
  return KIND_RULES.find((r) => r.test(shaped))?.kind ?? 'button';
}

const inside = (p: { x: number; y: number }, b: Box) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The remembered name for a box: a mapped element it overlaps, else a familiar element inside it; null when none. */
export function nameFor(box: Box, mapped: MappedElement[], familiar: FamiliarElement[]): string | null {
  const m = mapped.find((e) => overlaps(e.box, box) && (inside(boxCenter(e.box), box) || inside(boxCenter(box), e.box)));
  if (m) return m.name;
  return familiar.find((f) => inside(f, box))?.name ?? null;
}

/** Static, moved or in-motion: pixels changing inside the box first, then a same-named element that sat elsewhere. */
export function classify(name: string, box: Box, frame: Frame, prev: InventoryElement[], prevFrame: Frame | null | undefined): ElementState {
  if (prevFrame && boxDistance(prevFrame.data, frame.data, box) > MOTION_THRESHOLD) return 'in-motion';
  const before = prev.find((e) => key(e.name) === key(name));
  if (!before) return 'static';
  const a = boxCenter(before.box);
  const b = boxCenter(box);
  return Math.hypot(a.x - b.x, a.y - b.y) > MOVE_THRESHOLD ? 'moved' : 'static';
}

/**
 * The full-screen reading: every detectable element on the frame (from the 320x180 drift buffer,
 * whatever source captured it), named from memory where possible, with grid cells and its state.
 * No frame gives an empty inventory.
 */
export function buildInventory({ frame, mapped = [], familiar = [], prev = [], prevFrame }: InventoryInput): InventoryElement[] {
  if (!frame) return [];
  const used = new Map<string, number>();
  return segmentRegions(foregroundCells(frame.data)).slice(0, INVENTORY_LIMIT).map((box, i) => {
    const kind = guessKind(box);
    const remembered = nameFor(box, mapped, familiar);
    const base = remembered ?? `${kind} ${cellOf(box)}`;
    const n = (used.get(key(base)) ?? 0) + 1;
    used.set(key(base), n);
    const name = n > 1 ? `${base} #${n}` : base;
    return { id: `inv_${i}`, name, known: remembered !== null, kind, box, cell: cellOf(box), mapCells: mapCells(box), state: classify(name, box, frame, prev, prevFrame) };
  });
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** One planner / grounding context line of an inventory element. */
export function inventoryLine(e: InventoryElement): string {
  const c = boxCenter(e.box);
  return `[Screen element] ${e.kind} "${e.name}" at (${pct(c.x)}, ${pct(c.y)}) cell ${e.cell}, map cells ${e.mapCells}, ${e.state}`;
}

/** The context lines of a whole inventory (named elements first). */
export const inventoryLines = (list: InventoryElement[]) => [...list.filter((e) => e.known), ...list.filter((e) => !e.known)].map(inventoryLine);

/** The inventory element best matching a target name (exact name first, then word similarity ≥ 0.5); null when none. */
export function findElement(list: InventoryElement[], target: string): InventoryElement | null {
  const exact = list.find((e) => key(e.name) === key(target));
  if (exact) return exact;
  let best: InventoryElement | null = null;
  let score = 0;
  for (const e of list) {
    const s = similarity(target, e.name);
    if (s >= 0.5 && s > score) {
      best = e;
      score = s;
    }
  }
  return best;
}

/** Counts per state, for the panel header. */
export function stateCounts(list: InventoryElement[]): Record<ElementState, number> {
  const out: Record<ElementState, number> = { static: 0, moved: 0, 'in-motion': 0 };
  for (const e of list) out[e.state]++;
  return out;
}
