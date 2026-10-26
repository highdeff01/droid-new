import type { Annotation, SavedCard, WorkflowStep } from './types.js';
import type { RulerPoint } from './ruler.js';
import { similarity } from './planner.js';

/** A named on-screen element and its center, normalized 0..1. */
export interface MappedElement {
  name: string;
  x: number;
  y: number;
  /** Where the coordinate came from: an AI point-out, the current plan, or a saved (familiar) flow. */
  origin: 'annotation' | 'step' | 'flow';
}

/** The screen edges an endpoint may name. */
export type Edge = 'left' | 'right' | 'top' | 'bottom';

const stepElement = (origin: MappedElement['origin']) => (s: WorkflowStep): MappedElement[] =>
  s.target ? [{ name: s.target, x: s.correctedX ?? s.x, y: s.correctedY ?? s.y, origin }] : [];

/**
 * The element map: AI point-out boxes (center), then current workflow targets, then saved
 * flow targets (learned/familiar coordinates). The first entry of a name wins.
 */
export function buildElementMap(annotations: Annotation[], steps: WorkflowStep[], cards: SavedCard[]): MappedElement[] {
  const all = [
    ...annotations.map((a): MappedElement => ({ name: a.label, x: a.actX ?? a.x + a.w / 2, y: a.actY ?? a.y + a.h / 2, origin: 'annotation' })),
    ...steps.flatMap(stepElement('step')),
    ...cards.flatMap((c) => c.steps.flatMap(stepElement('flow'))),
  ];
  const seen = new Set<string>();
  return all.filter((e) => {
    const key = e.name.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The mapped element for `name`: exact (case-insensitive) first, else the best word match ≥ 0.5. */
export function findElement(name: string, map: MappedElement[]): MappedElement | null {
  const key = name.trim().toLowerCase();
  const exact = map.find((e) => e.name.trim().toLowerCase() === key);
  if (exact) return exact;
  let best: MappedElement | null = null;
  let score = 0.5;
  for (const e of map) {
    const s = Math.max(similarity(name, e.name), similarity(e.name, name));
    if (s >= score) {
      best = e;
      score = s;
    }
  }
  return best;
}

/** One endpoint of a measure query: a named element, a coordinate or a screen edge. */
export type Endpoint = { kind: 'element'; name: string } | { kind: 'point'; x: number; y: number; native: boolean } | { kind: 'edge'; edge: Edge };

/** Parses one endpoint: "x,y" (fractions when both ≤ 1, else native pixels), "left [edge]", or an element name. */
export function parseEndpoint(text: string): Endpoint {
  const t = text.trim();
  const coord = /^\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?$/.exec(t);
  if (coord) {
    const x = Number(coord[1]);
    const y = Number(coord[2]);
    return { kind: 'point', x, y, native: x > 1 || y > 1 };
  }
  const edge = /^(?:the\s+)?(left|right|top|bottom)(?:\s+(?:edge|side))?(?:\s+of\s+(?:the\s+)?screen)?$/i.exec(t);
  if (edge) return { kind: 'edge', edge: edge[1].toLowerCase() as Edge };
  return { kind: 'element', name: t.replace(/^the\s+/i, '') };
}

/** Splits "A to B to C" (or "A -> B", "A and B", "A, then B") into endpoints. */
export function parseMeasureQuery(query: string): Endpoint[] {
  return query.split(/\s+(?:to|and|->|→)\s+/i).map((s) => s.trim()).filter(Boolean).map(parseEndpoint);
}

/** The point on `edge` nearest to `from` (the perpendicular foot). */
function edgePoint(edge: Edge, from: RulerPoint): RulerPoint {
  const feet: Record<Edge, RulerPoint> = { left: { x: 0, y: from.y }, right: { x: 1, y: from.y }, top: { x: from.x, y: 0 }, bottom: { x: from.x, y: 1 } };
  return feet[edge];
}

/** A resolved measurement path with the label of each point. */
export interface ResolvedPath {
  points: RulerPoint[];
  labels: string[];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A non-edge endpoint as a normalized point and label; throws naming an unknown element. */
function resolvePoint(e: Exclude<Endpoint, { kind: 'edge' }>, map: MappedElement[], srcW: number, srcH: number): { point: RulerPoint; label: string } {
  if (e.kind === 'point') {
    const point = e.native ? { x: clamp01(e.x / srcW), y: clamp01(e.y / srcH) } : { x: clamp01(e.x), y: clamp01(e.y) };
    return { point, label: `(${Math.round(point.x * srcW)}, ${Math.round(point.y * srcH)})px` };
  }
  const found = findElement(e.name, map);
  if (!found) {
    const known = map.map((m) => `"${m.name}"`).slice(0, 12).join(', ') || 'none — run Point out or plan/record a flow first';
    throw new Error(`Unknown element "${e.name}" — not in the element map (known: ${known}); no coordinate invented`);
  }
  return { point: { x: found.x, y: found.y }, label: found.name };
}

/**
 * Resolves endpoints to normalized points. An edge resolves to the perpendicular foot from
 * its neighbouring point (previous, else next). Throws when an element is unknown, when
 * fewer than two endpoints are given, or when only edges are given.
 */
export function resolvePath(endpoints: Endpoint[], map: MappedElement[], srcW: number, srcH: number): ResolvedPath {
  if (endpoints.length < 2) throw new Error('A measurement needs at least two endpoints, e.g. "Files icon to Game icon" or "Files icon to left edge"');
  const fixed = endpoints.map((e) => (e.kind === 'edge' ? null : resolvePoint(e, map, srcW, srcH)));
  if (fixed.every((f) => f === null)) throw new Error('A measurement needs at least one element or coordinate besides screen edges');
  const points: RulerPoint[] = [];
  const labels: string[] = [];
  endpoints.forEach((e, i) => {
    const f = fixed[i];
    if (f) {
      points.push(f.point);
      labels.push(f.label);
      return;
    }
    const edge = (e as { edge: Edge }).edge;
    const anchor = points[i - 1] ?? fixed.slice(i + 1).find((x) => x !== null)!.point;
    points.push(edgePoint(edge, anchor));
    labels.push(`${edge} edge`);
  });
  return { points, labels };
}
