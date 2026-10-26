import { SAMPLE_VIEW, viewPoint, type ViewSize } from './ai.js';

/** Columns (numbered 1..12, left to right) and rows (lettered A..H, top to bottom) of the spatial grid. */
export const GRID_COLS = 12;
export const GRID_ROWS = 8;
const ROW_LETTERS = 'ABCDEFGH';

/** One grid cell by zero-based row and column. */
export interface GridCell {
  row: number;
  col: number;
}

type Point = { x: number; y: number };

/** The label of a cell: row letter + column number, e.g. row 2, col 4 → "C5". */
export const cellLabel = ({ row, col }: GridCell) => `${ROW_LETTERS[row]}${col + 1}`;

/** Every column's and row's label, in order. */
export const COLUMN_LABELS = Array.from({ length: GRID_COLS }, (_, c) => String(c + 1));
export const ROW_LABELS = ROW_LETTERS.split('');

/** A cell reference ("C5", " c5 ") as a cell; null when it is not one of A1..H12. */
export function parseCell(ref: unknown): GridCell | null {
  if (typeof ref !== 'string') return null;
  const m = /^([A-Ha-h])\s*(\d{1,2})$/.exec(ref.trim());
  if (!m) return null;
  const col = Number(m[2]) - 1;
  if (col < 0 || col >= GRID_COLS) return null;
  return { row: m[1].toUpperCase().charCodeAt(0) - 65, col };
}

/** The normalized box (fractions 0..1 of the screen) a cell covers. */
export function cellBox({ row, col }: GridCell) {
  return { x: col / GRID_COLS, y: row / GRID_ROWS, w: 1 / GRID_COLS, h: 1 / GRID_ROWS };
}

/** A fraction inside a cell, clamped to 0..1; missing or non-numeric means the centre. */
function inCell(v: unknown): number {
  const n = typeof v === 'string' ? Number.parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

/**
 * The exact screen point (fractions 0..1) of a cell reference plus a position inside that
 * cell (cx, cy measured from the cell's top-left, clamped to 0..1); null for an invalid cell.
 */
export function resolveCell(ref: unknown, cx: unknown = 0.5, cy: unknown = 0.5): Point | null {
  const cell = parseCell(ref);
  if (!cell) return null;
  const b = cellBox(cell);
  return { x: b.x + inCell(cx) * b.w, y: b.y + inCell(cy) * b.h };
}

/** The cell containing a screen point (fractions 0..1, clamped onto the grid). */
export function cellAt(p: Point): GridCell {
  const idx = (v: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(v * n)));
  return { row: idx(p.y, GRID_ROWS), col: idx(p.x, GRID_COLS) };
}

/** A point as its grid reference: cell label plus the position inside it, e.g. "C5 (0.25, 0.80)". */
export function gridRef(p: Point): string {
  const cell = cellAt(p);
  const b = cellBox(cell);
  const f = (v: number) => Math.min(1, Math.max(0, v)).toFixed(2);
  return `${cellLabel(cell)} (${f((p.x - b.x) / b.w)}, ${f((p.y - b.y) / b.h)})`;
}

const range = (i: number, n: number, px: number) => `${(i / n).toFixed(3)}..${((i + 1) / n).toFixed(3)} (${Math.round((i * px) / n)}-${Math.round(((i + 1) * px) / n)}px)`;

/** The grid definition sent with every prompt that asks the model for a point, for a `view`-sized screenshot. */
export function gridPrompt(view: ViewSize): string {
  return [
    `Spatial grid: the ${view.w}x${view.h} screenshot is divided into ${GRID_COLS} columns x ${GRID_ROWS} rows. Rows are letters A..H from top to bottom, columns are numbers 1..12 from left to right; cell "A1" is the top-left, "H12" the bottom-right.`,
    `Columns (x): ${COLUMN_LABELS.map((c, i) => `${c}=${range(i, GRID_COLS, view.w)}`).join(', ')}.`,
    `Rows (y): ${ROW_LABELS.map((r, i) => `${r}=${range(i, GRID_ROWS, view.h)}`).join(', ')}.`,
    'Give every point as "cell" (e.g. "C5") plus "cx","cy": the position inside that cell as fractions 0..1 from its top-left (0.5,0.5 is the cell centre). First pick the cell containing the target, then refine inside it.',
  ].join('\n');
}

/** The grid definition for a sample-space (480x270) screenshot. */
export const GRID_PROMPT = gridPrompt(SAMPLE_VIEW);

/**
 * The point a model reply gives, in the 0..1 sample space: its "cell" + "cx","cy" when the cell
 * is valid (resolution independent), otherwise the legacy global "x","y" (fractions, or pixels of
 * the `view`-sized image the model saw), falling back to `fallback` when those are missing.
 * Throws AiError when there is no usable point and no fallback.
 */
export function replyPoint(r: Record<string, unknown>, fallback?: Point, view: ViewSize = SAMPLE_VIEW): Point {
  const fromCell = resolveCell(r.cell, r.cx, r.cy);
  if (fromCell) return fromCell;
  return viewPoint(r.x ?? fallback?.x, r.y ?? fallback?.y, view);
}
