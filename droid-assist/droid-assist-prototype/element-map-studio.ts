import type { FamiliarElement, Frame } from './types.js';
import type { Box } from './assist-ai.js';
import { gridRef } from './grid.js';

/** The element-map grid: finer than the A1..H12 planner grid and drawn only in Element-map mode. */
export const MAP_COLS = 24;
export const MAP_ROWS = 16;

/** Most mapped elements kept. */
export const MAP_LIMIT = 80;

/** Smallest box side (fraction of the screen) a drag must span to become an element. */
export const MIN_BOX = 0.005;

/** An element the user mapped by drawing its boundary on the live frame. Normalized 0..1. */
export interface MappedElement {
  id: string;
  name: string;
  box: Box;
  /** When it was mapped (ms since epoch). */
  mappedAt: number;
  /** The frame it was drawn on — the template its boundary is verified against. */
  frame?: Frame;
}

type Point = { x: number; y: number };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const key = (name: string) => name.trim().toLowerCase();

/** The box spanned by two drag corners, clamped to the screen; null when it is too small. */
export function dragBox(a: Point, b: Point): Box | null {
  const x0 = clamp01(Math.min(a.x, b.x));
  const y0 = clamp01(Math.min(a.y, b.y));
  const w = clamp01(Math.max(a.x, b.x)) - x0;
  const h = clamp01(Math.max(a.y, b.y)) - y0;
  return w >= MIN_BOX && h >= MIN_BOX ? { x: x0, y: y0, w, h } : null;
}

/** The centre point of a box. */
export const boxCenter = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** The map cell containing a point, as "R<row>C<col>" (1-based, R1C1 top-left). */
export function mapCell(p: Point): string {
  const idx = (v: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(v * n))) + 1;
  return `R${idx(p.y, MAP_ROWS)}C${idx(p.x, MAP_COLS)}`;
}

/** The map cells a box spans, as "R<a>C<b>..R<c>C<d>" (top-left cell to bottom-right cell). */
export function mapCells(b: Box): string {
  const eps = 1e-9;
  return `${mapCell(b)}..${mapCell({ x: b.x + b.w - eps, y: b.y + b.h - eps })}`;
}

/**
 * Adds a mapped element; an element with the same name (case-insensitive) is replaced in
 * place of the newest. A blank name changes nothing. Keeps at most MAP_LIMIT elements.
 */
export function mapElement(list: MappedElement[], el: MappedElement): MappedElement[] {
  if (!el.name.trim()) return list;
  const named = { ...el, name: el.name.trim() };
  return [named, ...list.filter((e) => key(e.name) !== key(named.name))].slice(0, MAP_LIMIT);
}

/** Drops the mapped element with `id`. */
export const unmapElement = (list: MappedElement[], id: string) => list.filter((e) => e.id !== id);

/** A mapped element as a familiar-elements memory entry (its centre, seen now). */
export const toFamiliar = (el: MappedElement, now: number, patch?: string): FamiliarElement => ({ id: el.id, name: el.name, x: boxCenter(el.box).x, y: boxCenter(el.box).y, patch, lastSeen: now });

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** One prompt line for a mapped element: name, boundary box, planner-grid cell of its centre and map cells. */
export function mappedLine(el: MappedElement): string {
  const b = el.box;
  return `[Mapped element] "${el.name}" boundary x=${pct(b.x)}..${pct(b.x + b.w)}, y=${pct(b.y)}..${pct(b.y + b.h)} (box x=${b.x.toFixed(3)},y=${b.y.toFixed(3)},w=${b.w.toFixed(3)},h=${b.h.toFixed(3)}), center ${gridRef(boxCenter(b))}, map cells ${mapCells(b)}`;
}

/** The planning / grounding context lines for every user-mapped element, newest first. */
export const mapContext = (list: MappedElement[]) => list.map(mappedLine);

/** The mapped element whose boundary contains `p`, or null. */
export function mappedAt(list: MappedElement[], p: Point): MappedElement | null {
  return list.find((e) => p.x >= e.box.x && p.x <= e.box.x + e.box.w && p.y >= e.box.y && p.y <= e.box.y + e.box.h) ?? null;
}
