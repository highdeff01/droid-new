import type { Frame } from './types.js';
import { MATCHED, STABLE, patchDistance } from './drift.js';

type Point = { x: number; y: number };

/** How a moved element must sit relative to its anchor in a requested arrangement. */
export type Relation = 'below' | 'above' | 'left_of' | 'right_of';

/** Every relation the planner may return in "expect". */
export const RELATIONS: readonly Relation[] = ['below', 'above', 'left_of', 'right_of'];

/** One requested placement: `element` must be `relation` of `anchor` ("Files" below "Game"). */
export interface Expectation {
  element: string;
  relation: Relation;
  anchor: string;
}

/** An element a drag moved: where it was grabbed, where it should now be, and the frame before the drag. */
export interface MovedElement {
  name: string;
  from: Point;
  to: Point;
  before: Frame | null;
}

/** Where an element was re-detected (null when it was not) and how. */
export interface Sighting {
  at: Point | null;
  detail: string;
}

/** The final pass's ruling on one element of the arrangement. */
export interface ElementVerdict {
  element: string;
  pass: boolean;
  at: Point | null;
  detail: string;
  before: Frame | null;
}

/** Distance (normalized) within which an element counts as at a point. */
export const POSITION_TOLERANCE = 0.05;
/** Off-axis distance within which two elements share a column (below/above) or a row (left/right). */
export const LINE_TOLERANCE = 0.08;
/** On-axis distance an element must clear its anchor by. */
export const MIN_GAP = 0.02;

const PATCH = 16;
const SEARCH_RADIUS = 24;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const pct = (p: Point) => `(${(p.x * 100).toFixed(1)}%, ${(p.y * 100).toFixed(1)}%)`;
const toSample = (v: number, size: number) => Math.min(size - (PATCH >> 1) - 1, Math.max(PATCH >> 1, Math.round(v * size)));

/**
 * Finds the patch around `from` in `ref` on `live`, searching around `near`. Resolves where it
 * matched (normalized) when the best match is within MATCHED, otherwise null.
 */
export function findPatch(ref: ImageData, from: Point, live: ImageData, near: Point, radius = SEARCH_RADIUS): { at: Point; distance: number } | null {
  const fx = toSample(from.x, ref.width);
  const fy = toSample(from.y, ref.height);
  const nx = Math.round(near.x * live.width);
  const ny = Math.round(near.y * live.height);
  let best: { d: number; x: number; y: number } | null = null;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d = patchDistance(ref, fx, fy, live, nx + dx, ny + dy, PATCH);
      if (d !== null && (!best || d < best.d)) best = { d, x: nx + dx, y: ny + dy };
    }
  }
  return best && best.d <= MATCHED ? { at: { x: best.x / live.width, y: best.y / live.height }, distance: best.d } : null;
}

/** Whether the patch at `from` changed between the frames, i.e. what was there has left. */
function leftStart(before: ImageData, after: ImageData, from: Point): boolean {
  const x = toSample(from.x, before.width);
  const y = toSample(from.y, before.height);
  return (patchDistance(before, x, y, after, x, y, PATCH) ?? 1) > STABLE;
}

/** Template evidence: where the grabbed patch now is near `near` on `after`, or why it is not. */
function templateSighting(el: MovedElement, near: Point, after: Frame): Sighting {
  if (!el.before) return { at: null, detail: 'no screenshot before the drag' };
  const moving = dist(el.from, near) > POSITION_TOLERANCE;
  if (moving && !leftStart(el.before.data, after.data, el.from)) return { at: null, detail: `template still at the start ${pct(el.from)}` };
  const hit = findPatch(el.before.data, el.from, after.data, near);
  return hit ? { at: hit.at, detail: `template at ${pct(hit.at)} (match ${hit.distance.toFixed(3)})` } : { at: null, detail: `template not found near ${pct(near)}` };
}

/**
 * Re-detects a moved element near `near`: by template matching on the after-frame when there
 * are frames, and by the element map when the element is mapped. When both are present they
 * must agree; with neither there is no evidence and the element is not sighted.
 */
export function sightElement(el: MovedElement, near: Point, after: Frame | null, mapped: Point | null): Sighting {
  const tpl = after && el.before ? templateSighting(el, near, after) : null;
  if (tpl && !tpl.at) return tpl;
  const map = mapped ? `element map at ${pct(mapped)}` : null;
  if (tpl?.at && mapped && dist(tpl.at, mapped) > POSITION_TOLERANCE) return { at: null, detail: `${tpl.detail} but ${map} — they disagree` };
  const at = tpl?.at ?? mapped;
  if (!at) return { at: null, detail: 'no screenshots and not in the element map — cannot confirm' };
  return { at, detail: [tpl?.detail, map].filter(Boolean).join(', ') };
}

/** After one drag: did the element really land within POSITION_TOLERANCE of the intended drop point? */
export function checkMoved(el: MovedElement, after: Frame | null, mapped: Point | null): { moved: boolean } & Sighting {
  const s = sightElement(el, el.to, after, mapped);
  if (!s.at) return { moved: false, ...s };
  const off = dist(s.at, el.to);
  return off <= POSITION_TOLERANCE ? { moved: true, ...s } : { moved: false, at: s.at, detail: `${s.detail} — ${(off * 100).toFixed(1)}% away from the drop point ${pct(el.to)}` };
}

const RELATION_TEST: Record<Relation, (el: Point, anchor: Point) => boolean> = {
  below: (e, a) => Math.abs(e.x - a.x) <= LINE_TOLERANCE && e.y - a.y > MIN_GAP,
  above: (e, a) => Math.abs(e.x - a.x) <= LINE_TOLERANCE && a.y - e.y > MIN_GAP,
  right_of: (e, a) => Math.abs(e.y - a.y) <= LINE_TOLERANCE && e.x - a.x > MIN_GAP,
  left_of: (e, a) => Math.abs(e.y - a.y) <= LINE_TOLERANCE && a.x - e.x > MIN_GAP,
};

/** Whether `el` is `relation` of `anchor`. */
export const relationHolds = (relation: Relation, el: Point, anchor: Point) => RELATION_TEST[relation](el, anchor);

const nameKey = (s: string) => s.toLowerCase().replace(/\b(the|icon|button|file|folder)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Whether two names refer to the same element ("Files icon" and "files"). */
export function sameElement(a: string, b: string): boolean {
  const x = nameKey(a);
  const y = nameKey(b);
  return !!x && !!y && (x === y || x.split(' ').includes(y) || y.split(' ').includes(x));
}

/** Every element the verdict covers: each moved element, then each expectation element that was not moved. */
function coveredNames(moved: MovedElement[], expect: Expectation[]): string[] {
  const names = moved.map((m) => m.name);
  for (const e of expect) if (!names.some((n) => sameElement(n, e.element))) names.push(e.element);
  return names;
}

/** One element's verdict: re-detected, and every requested relation holds against its re-detected or mapped anchor. */
function judge(name: string, at: Map<string, Sighting>, expect: Expectation[], intended: Point | null, mapAt: (name: string) => Point | null): Omit<ElementVerdict, 'element' | 'before'> {
  const s = at.get(name)!;
  if (!s.at) return { pass: false, at: null, detail: `not re-detected — ${s.detail}` };
  const where = (anchor: string) => [...at.entries()].find(([n]) => sameElement(n, anchor))?.[1].at ?? mapAt(anchor);
  const rules = expect.filter((e) => sameElement(e.element, name));
  if (!rules.length) {
    const ok = !!intended && dist(s.at, intended) <= POSITION_TOLERANCE;
    return { pass: ok, at: s.at, detail: `${s.detail} — ${ok ? 'at' : 'not at'} its drop point${intended ? ` ${pct(intended)}` : ''}` };
  }
  const failed: string[] = [];
  for (const r of rules) {
    const a = where(r.anchor);
    if (!a) failed.push(`anchor "${r.anchor}" not located`);
    else if (!relationHolds(r.relation, s.at, a)) failed.push(`not ${r.relation.replace('_', ' ')} "${r.anchor}" at ${pct(a)}`);
  }
  const asked = rules.map((r) => `${r.relation.replace('_', ' ')} "${r.anchor}"`).join(', ');
  return { pass: !failed.length, at: s.at, detail: `${s.detail} — ${failed.length ? failed.join('; ') : `${asked} as requested`}` };
}

/**
 * The verification pass after a rearrangement: re-detects every moved element on the final frame
 * (template + element map, as `sightElement`), locates the anchors of the requested relations,
 * and rules pass/fail per element — moved elements first, then unmoved expectation elements.
 * @param mapAt the element map: where a named element is, or null when it is not mapped
 */
export function verifyArrangement(moved: MovedElement[], expect: Expectation[], final: Frame | null, mapAt: (name: string) => Point | null): ElementVerdict[] {
  const names = coveredNames(moved, expect);
  const sightings = new Map<string, Sighting>();
  for (const name of names) {
    const m = moved.find((x) => x.name === name);
    const mapped = mapAt(name);
    sightings.set(name, m ? sightElement(m, m.to, final, mapped) : mapped ? { at: mapped, detail: `element map at ${pct(mapped)}` } : { at: null, detail: 'not in the element map' });
  }
  return names.map((name) => {
    const m = moved.find((x) => x.name === name) ?? null;
    return { element: name, before: m?.before ?? null, ...judge(name, sightings, expect, m?.to ?? null, mapAt) };
  });
}
