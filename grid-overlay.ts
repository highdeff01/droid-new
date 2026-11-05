import { COLUMN_LABELS, GRID_COLS, GRID_ROWS, ROW_LABELS, cellLabel } from './grid.js';

/** Default alpha of the grid lines: faint enough that the captured frame always shows through. */
export const DEFAULT_GRID_OPACITY = 0.12;
/** Valid range of the grid line alpha (the Settings slider). */
export const GRID_OPACITY_RANGE: [number, number] = [0.04, 0.5];

/** What the grid draws: line alpha and whether every cell carries its A1..H12 label. */
export interface GridStyle {
  opacity: number;
  cellLabels: boolean;
}

/** The subset of a 2D canvas context the grid draws with (lines and text only, never a fill). */
export type GridCanvas = Pick<CanvasRenderingContext2D, 'strokeStyle' | 'fillStyle' | 'lineWidth' | 'font' | 'beginPath' | 'moveTo' | 'lineTo' | 'stroke' | 'fillText'>;

/** The gridlines at `opacity`. */
function drawLines(ctx: GridCanvas, w: number, h: number, opacity: number) {
  ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 1; c < GRID_COLS; c++) {
    ctx.moveTo((c * w) / GRID_COLS, 0);
    ctx.lineTo((c * w) / GRID_COLS, h);
  }
  for (let r = 1; r < GRID_ROWS; r++) {
    ctx.moveTo(0, (r * h) / GRID_ROWS);
    ctx.lineTo(w, (r * h) / GRID_ROWS);
  }
  ctx.stroke();
}

/** Column numbers along the top edge and row letters along the left edge. */
function drawEdgeLabels(ctx: GridCanvas, w: number, h: number, opacity: number) {
  const cw = w / GRID_COLS;
  const ch = h / GRID_ROWS;
  ctx.font = 'bold 10px sans-serif';
  ctx.fillStyle = `rgba(250, 204, 21, ${Math.min(0.75, opacity * 4)})`;
  COLUMN_LABELS.forEach((label, c) => ctx.fillText(label, c * cw + cw / 2 - 4, 10));
  ROW_LABELS.forEach((label, r) => ctx.fillText(label, 2, r * ch + ch / 2 + 4));
}

/** Every cell's A1..H12 label in its bottom-left corner. */
function drawCellLabels(ctx: GridCanvas, w: number, h: number, opacity: number) {
  const cw = w / GRID_COLS;
  const ch = h / GRID_ROWS;
  ctx.font = '9px sans-serif';
  ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.4, opacity * 2)})`;
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) ctx.fillText(cellLabel({ row: r, col: c }), c * cw + 3, (r + 1) * ch - 3);
  }
}

/** The transparent spatial grid: faint lines, edge labels, and per-cell labels only when asked. */
export function drawGrid(ctx: GridCanvas, w: number, h: number, style: GridStyle) {
  drawLines(ctx, w, h, style.opacity);
  drawEdgeLabels(ctx, w, h, style.opacity);
  if (style.cellLabels) drawCellLabels(ctx, w, h, style.opacity);
}
