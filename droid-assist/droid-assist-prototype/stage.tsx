import { useEffect, useRef, useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import type { Measurement } from './ruler.js';
import styles from './droid-assist.module.css';

const RULER = '#f97316';

/** Draws the ruler polyline: numbered points, each segment's px / % / dx·dy label, and the total. */
function drawRuler(ctx: CanvasRenderingContext2D, m: Measurement, w: number, h: number) {
  ctx.strokeStyle = RULER;
  ctx.fillStyle = RULER;
  ctx.lineWidth = 2;
  ctx.font = 'bold 11px sans-serif';
  m.segments.forEach((s) => {
    ctx.beginPath();
    ctx.moveTo(s.from.x * w, s.from.y * h);
    ctx.lineTo(s.to.x * w, s.to.y * h);
    ctx.stroke();
    const mx = ((s.from.x + s.to.x) / 2) * w;
    const my = ((s.from.y + s.to.y) / 2) * h;
    ctx.fillText(`${s.px}px · ${s.pct}%`, mx + 6, my - 6);
    ctx.fillText(`dx ${s.dxPx} dy ${s.dyPx}`, mx + 6, my + 8);
  });
  m.points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(String(i + 1), p.x * w + 7, p.y * h - 7);
  });
  if (m.segments.length) {
    const last = m.points[m.points.length - 1];
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(`Σ ${m.totalPx}px · ${m.totalPct}% of screen`, Math.min(last.x * w + 8, w - 200), Math.min(last.y * h + 22, h - 6));
  }
}

/**
 * The live screen with its semi-transparent overlay canvas: historical mouse trail,
 * step markers (recorded vs drift-corrected), AI annotations and the AI cursor.
 */
export function Stage({ engine }: { engine: AssistEngine }) {
  const { source, demoCanvasRef, frames, captureLost, DEMO_W, DEMO_H, trail, steps, annotations, cursor, settings, recording, replaying, activeIndex, ruler } = engine;
  const galleryFrame = ruler.on && ruler.frameId !== null ? ruler.frame : null;
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    const c = overlayRef.current;
    const wrap = wrapRef.current;
    if (!c || !wrap) return;
    const w = (c.width = wrap.clientWidth);
    const h = (c.height = wrap.clientHeight);
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);

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

    if (ruler.measurement) drawRuler(ctx, ruler.measurement, w, h);
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
        onClick={(e) => {
          const p = norm(e);
          engine.onStageClick(p.x, p.y, e.altKey);
        }}
      >
        <canvas ref={demoCanvasRef} width={DEMO_W} height={DEMO_H} className={styles.screen} style={{ display: source === 'demo' && !galleryFrame ? 'block' : 'none' }} />
        {galleryFrame ? <img src={galleryFrame.url} alt={`Gallery frame ${galleryFrame.id}`} className={styles.screen} /> : source !== 'demo' && frames[0] && <img src={frames[0].url} alt="Live screen" className={styles.screen} />}
        <canvas ref={overlayRef} className={styles.overlay} />
        {ruler.on && <span className={styles.replayBadge}>📏 RULER · {galleryFrame ? `frame #${galleryFrame.id}` : 'live'} — click points</span>}
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
