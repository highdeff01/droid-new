/** A point normalized to 0..1 of the screen. */
export interface RulerPoint {
  x: number;
  y: number;
}

/** One measured segment between two consecutive ruler points, in native screen pixels. */
export interface Segment {
  from: RulerPoint;
  to: RulerPoint;
  /** Signed offsets in native pixels (to − from). */
  dxPx: number;
  dyPx: number;
  /** Euclidean length in native pixels. */
  px: number;
  /** Length as a percent of the screen diagonal. */
  pct: number;
  /** Signed dx as a percent of the screen width, dy of the screen height. */
  dxPct: number;
  dyPct: number;
}

/** A polyline measurement: every segment plus the total length. */
export interface Measurement {
  points: RulerPoint[];
  segments: Segment[];
  totalPx: number;
  /** Total length as a percent of the screen diagonal. */
  totalPct: number;
  srcW: number;
  srcH: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** The segment from `a` to `b` on a srcW×srcH screen. */
export function measureSegment(a: RulerPoint, b: RulerPoint, srcW: number, srcH: number): Segment {
  const dx = (b.x - a.x) * srcW;
  const dy = (b.y - a.y) * srcH;
  const px = Math.hypot(dx, dy);
  return {
    from: a,
    to: b,
    dxPx: Math.round(dx),
    dyPx: Math.round(dy),
    px: Math.round(px),
    pct: round1((px / Math.hypot(srcW, srcH)) * 100),
    dxPct: round1((b.x - a.x) * 100),
    dyPct: round1((b.y - a.y) * 100),
  };
}

/** Measures the polyline through `points` on a srcW×srcH screen; fewer than two points has no segments. */
export function measurePath(points: RulerPoint[], srcW: number, srcH: number): Measurement {
  const segments = points.slice(1).map((p, i) => measureSegment(points[i], p, srcW, srcH));
  const exact = points.slice(1).reduce((sum, p, i) => sum + Math.hypot((p.x - points[i].x) * srcW, (p.y - points[i].y) * srcH), 0);
  return { points, segments, totalPx: Math.round(exact), totalPct: round1((exact / Math.hypot(srcW, srcH)) * 100), srcW, srcH };
}

const signed = (v: number) => `${v >= 0 ? '+' : ''}${v}`;

/** One line per segment: length in px and % of screen, plus dx/dy. */
export const segmentLine = (s: Segment, i: number) => `#${i + 1}: ${s.px}px (${s.pct}% of screen) · dx ${signed(s.dxPx)}px (${signed(s.dxPct)}%) · dy ${signed(s.dyPx)}px (${signed(s.dyPct)}%)`;

/** A whole measurement as one log line. */
export function describeMeasurement(m: Measurement, labels: string[] = []): string {
  if (!m.segments.length) return `${m.points.length} point(s) — add another point to measure`;
  const path = labels.length ? `${labels.join(' → ')}: ` : '';
  return `${path}total ${m.totalPx}px (${m.totalPct}% of screen, ${m.srcW}×${m.srcH}) — ${m.segments.map(segmentLine).join('; ')}`;
}
