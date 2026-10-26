import { useEffect, useRef, useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { COLUMN_LABELS, GRID_COLS, GRID_ROWS, ROW_LABELS, cellLabel } from './grid.js';
import { classifyGesture, type StagePoint } from './gesture.js';
import styles from './droid-assist.module.css';

/** The labeled spatial grid: light gridlines, column numbers / row letters on the edges, cell labels. */
function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const cw = w / GRID_COLS;
  const ch = h / GRID_ROWS;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 1; c < GRID_COLS; c++) {
    ctx.moveTo(c * cw, 0);
    ctx.lineTo(c * cw, h);
  }
  for (let r = 1; r < GRID_ROWS; r++) {
    ctx.moveTo(0, r * ch);
    ctx.lineTo(w, r * ch);
  }
  ctx.stroke();
  ctx.font = 'bold 10px sans-serif';
  ctx.fillStyle = 'rgba(250, 204, 21, 0.9)';
  COLUMN_LABELS.forEach((label, c) => ctx.fillText(label, c * cw + cw / 2 - 4, 10));
  ROW_LABELS.forEach((label, r) => ctx.fillText(label, 2, r * ch + ch / 2 + 4));
  ctx.font = '9px sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) ctx.fillText(cellLabel({ row: r, col: c }), c * cw + 3, (r + 1) * ch - 3);
  }
}

/** A test-click target: crosshair, ring and its label. */
function drawHighlight(ctx: CanvasRenderingContext2D, x: number, y: number, label: string) {
  ctx.strokeStyle = '#f43f5e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.moveTo(x - 24, y);
  ctx.lineTo(x + 24, y);
  ctx.moveTo(x, y - 24);
  ctx.lineTo(x, y + 24);
  ctx.stroke();
  ctx.fillStyle = '#f43f5e';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText(label, x + 20, Math.max(14, y - 20));
}

/**
 * The live screen with its semi-transparent overlay canvas: historical mouse trail,
 * step markers (recorded vs drift-corrected), AI annotations and the AI cursor.
 */
export function Stage({ engine }: { engine: AssistEngine }) {
  const { source, demoCanvasRef, frames, captureLost, DEMO_W, DEMO_H, trail, steps, annotations, cursor, settings, recording, replaying, activeIndex, highlight } = engine;
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState('');
  /** Where the current press started; a release far enough away from it is a drag. */
  const pressRef = useRef<StagePoint | null>(null);

  useEffect(() => {
    const c = overlayRef.current;
    const wrap = wrapRef.current;
    if (!c || !wrap) return;
    const w = (c.width = wrap.clientWidth);
    const h = (c.height = wrap.clientHeight);
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);

    if (settings.showGrid) drawGrid(ctx, w, h);

    if (settings.showTrail && trail.length > 1) {
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1];
        const b = trail[i];
        ctx.strokeStyle = `rgba(56, 189, 248, ${0.15 + 0.6 * (i / trail.length)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(a.x * w, a.y * h);
        ctx.lineTo(b.x * w, b.y * h);
        ctx.stroke();
      }
      trail.filter((p) => p.click).forEach((p) => {
        ctx.fillStyle = 'rgba(250, 204, 21, 0.85)';
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    steps.forEach((s, i) => {
      const color = s.status === 'failed' ? '#ef4444' : s.status === 'drift' ? '#eab308' : s.status === 'done' ? '#22c55e' : '#a78bfa';
      if (s.correctedX !== undefined && s.correctedY !== undefined && Math.hypot(s.correctedX - s.x, s.correctedY - s.y) > 0.003) {
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#eab308';
        ctx.beginPath();
        ctx.moveTo(s.x * w, s.y * h);
        ctx.lineTo(s.correctedX * w, s.correctedY * h);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const x = (s.correctedX ?? s.x) * w;
      const y = (s.correctedY ?? s.y) * h;
      ctx.strokeStyle = color;
      ctx.lineWidth = i === activeIndex ? 3 : 2;
      ctx.beginPath();
      ctx.arc(x, y, i === activeIndex ? 14 : 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(String(i + 1), x - 3, y + 4);
    });

    annotations.forEach((a) => {
      const color = a.tone === 'error' ? '#ef4444' : a.tone === 'warn' ? '#f59e0b' : '#38bdf8';
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.fillStyle = a.tone === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(56,189,248,0.12)';
      ctx.fillRect(a.x * w, a.y * h, a.w * w, a.h * h);
      ctx.strokeRect(a.x * w, a.y * h, a.w * w, a.h * h);
      ctx.fillStyle = color;
      ctx.font = 'bold 12px sans-serif';
      const ly = Math.max(14, a.y * h - 6);
      ctx.fillText(a.label, a.x * w + 4, ly);
      if (a.actX !== undefined && a.actY !== undefined) {
        ctx.beginPath();
        ctx.arc(a.actX * w, a.actY * h, 12, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    if (highlight) drawHighlight(ctx, highlight.x * w, highlight.y * h, highlight.label);

    if (cursor) {
      ctx.fillStyle = 'rgba(244, 114, 182, 0.9)';
      ctx.beginPath();
      ctx.moveTo(cursor.x * w, cursor.y * h);
      ctx.lineTo(cursor.x * w + 12, cursor.y * h + 16);
      ctx.lineTo(cursor.x * w + 4, cursor.y * h + 14);
      ctx.lineTo(cursor.x * w, cursor.y * h + 22);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(244, 114, 182, 0.5)';
      ctx.beginPath();
      ctx.arc(cursor.x * w, cursor.y * h, 20, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  const norm = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  return (
    <div className={styles.stageCol}>
      <div
        ref={wrapRef}
        className={`${styles.stage} ${recording ? styles.recording : ''}`}
        onMouseMove={(e) => {
          const p = norm(e);
          engine.onStageMove(p.x, p.y);
        }}
        onMouseDown={(e) => {
          pressRef.current = norm(e);
        }}
        onMouseUp={(e) => {
          const down = pressRef.current;
          pressRef.current = null;
          if (!down) return;
          const p = norm(e);
          const r = e.currentTarget.getBoundingClientRect();
          if (classifyGesture(down, p, r.width, r.height) === 'drag') engine.onStageDrag(down, p);
          else engine.onStageClick(p.x, p.y, e.altKey);
        }}
      >
        <canvas ref={demoCanvasRef} width={DEMO_W} height={DEMO_H} className={styles.screen} style={{ display: source === 'demo' ? 'block' : 'none' }} />
        {source !== 'demo' && frames[0] && <img src={frames[0].url} alt="Live screen" className={styles.screen} />}
        <canvas ref={overlayRef} className={styles.overlay} />
        {captureLost && <div className={styles.captureLost} role="alert">⚠ CAPTURE LOST — {captureLost}. Monitoring halted: restart capture or switch to the demo desktop.</div>}
        {recording && <span className={styles.recBadge}>● LIVE RECORDING</span>}
        {replaying && <span className={styles.replayBadge}>▶ REPLAYING</span>}
      </div>
      {recording && (
        <form
          className={styles.liveWrite}
          onSubmit={(e) => {
            e.preventDefault();
            engine.onStageType(typed);
            setTyped('');
          }}
        >
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Live write: type text to record a typing step, press Enter" aria-label="Live write text" />
        </form>
      )}
    </div>
  );
}
