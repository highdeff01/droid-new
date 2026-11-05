import type { WorkflowStep } from './types.js';
import type { Box } from './assist-ai.js';
import { boxCenter } from './element-map-studio.js';
import { similarity, uid } from './planner.js';
import { findElement, type InventoryElement } from './screen-inventory.js';

/** How one element leads to another: clicking it opens it, it holds it, or it sits next to it. */
export type ConnectionKind = 'opens' | 'contains' | 'adjacent';

/** A directed edge of the connection graph, by element name. */
export interface Connection {
  from: string;
  to: string;
  kind: ConnectionKind;
}

/** One hop of a route: the element to act on and how the previous hop led to it. */
export interface RouteHop {
  name: string;
  x: number;
  y: number;
  via: ConnectionKind | 'start';
}

/** An ordered route of elements to traverse for a goal, with its rank score. */
export interface Route {
  hops: RouteHop[];
  score: number;
  /** Where it came from: a saved access-path profile or freshly plotted from the inventory. */
  source: 'profile' | 'plotted';
}

/** A reusable access path: the route that reached a goal, with its track record. */
export interface RouteProfile {
  id: string;
  goal: string;
  hops: RouteHop[];
  uses: number;
  successes: number;
  savedAt: number;
}

/** How a saved route step resolves on the current screen: at the element's current spot, or by fresh grounding. */
export type HopResolution = { kind: 'inventory'; x: number; y: number } | { kind: 'ground'; target: string };

/** Max gap (fraction of the screen) between boxes that still counts as adjacent / as an opener of a panel. */
export const ADJACENT_GAP = 0.04;
/** Most alternative routes returned. */
export const ROUTE_LIMIT = 3;
/** Most profiles kept. */
export const PROFILE_LIMIT = 50;
/** Goal similarity a profile or target name must reach to be used. */
export const MATCH_MIN = 0.5;

const OPENERS = new Set<InventoryElement['kind']>(['button', 'tab']);
const key = (s: string) => s.trim().toLowerCase();
const contains = (outer: Box, inner: Box) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
/** Gap between two boxes along both axes (0 when they touch or overlap on that axis). */
function gap(a: Box, b: Box): number {
  const gx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const gy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.max(gx, gy);
}

/** The connection between two distinct elements, or null: containment first, then an opener next to a panel, then adjacency. */
function connect(a: InventoryElement, b: InventoryElement): ConnectionKind | null {
  if (a.kind === 'panel' && contains(a.box, b.box)) return 'contains';
  if (contains(b.box, a.box)) return null;
  if (gap(a.box, b.box) > ADJACENT_GAP) return null;
  return OPENERS.has(a.kind) && b.kind === 'panel' ? 'opens' : 'adjacent';
}

/** Every connection between inventory elements. */
export function connections(inventory: InventoryElement[]): Connection[] {
  const out: Connection[] = [];
  for (const a of inventory) {
    for (const b of inventory) {
      const kind = a === b ? null : connect(a, b);
      if (kind) out.push({ from: a.name, to: b.name, kind });
    }
  }
  return out;
}

const hop = (e: InventoryElement, via: RouteHop['via']): RouteHop => ({ name: e.name, ...boxCenter(e.box), via });

/** The innermost panel holding `e`, or null. */
function containerOf(e: InventoryElement, inventory: InventoryElement[]): InventoryElement | null {
  const holders = inventory.filter((p) => p !== e && p.kind === 'panel' && contains(p.box, e.box));
  return holders.sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)[0] ?? null;
}

/** The routes to `target`: through each opener of its container (opens → contains), or straight to it when none. */
function routesTo(target: InventoryElement, inventory: InventoryElement[], links: Connection[]): RouteHop[][] {
  const panel = containerOf(target, inventory);
  if (!panel) return [[hop(target, 'start')]];
  const openers = links.filter((c) => c.kind === 'opens' && key(c.to) === key(panel.name)).map((c) => inventory.find((e) => e.name === c.from)!);
  const direct = [hop(target, 'start')];
  return [...openers.map((o) => [hop(o, 'start'), hop(panel, 'opens'), hop(target, 'contains')]), direct];
}

/** Rank of a route: goal similarity of its target, fewer hops, settled (static) elements preferred. */
function scoreRoute(goal: string, hops: RouteHop[], inventory: InventoryElement[]): number {
  const target = hops[hops.length - 1];
  const settled = hops.filter((h) => inventory.find((e) => e.name === h.name)?.state === 'static').length / hops.length;
  return similarity(goal, target.name) * (1 / hops.length) * (0.5 + 0.5 * settled);
}

/** The saved profile matching `goal` best (≥ MATCH_MIN), or null. */
export function profileFor(profiles: RouteProfile[], goal: string): RouteProfile | null {
  let best: RouteProfile | null = null;
  let score = 0;
  for (const p of profiles) {
    const s = key(p.goal) === key(goal) ? 2 : similarity(goal, p.goal);
    if (s >= MATCH_MIN && s > score) [best, score] = [p, s];
  }
  return best;
}

/** A profile's rank: its success rate (unproven profiles count as 0.5), above any plotted route. */
const profileScore = (p: RouteProfile) => 1 + (p.uses ? p.successes / p.uses : 0.5);

/**
 * Ranked alternative routes for `goal`: the saved access-path profile first (when one matches),
 * then routes plotted from the inventory to every element whose name matches the goal. Best first, at most ROUTE_LIMIT.
 */
export function plotRoutes(goal: string, inventory: InventoryElement[], profiles: RouteProfile[] = []): Route[] {
  const links = connections(inventory);
  const targets = inventory.filter((e) => similarity(goal, e.name) >= MATCH_MIN);
  const plotted: Route[] = targets.flatMap((t) => routesTo(t, inventory, links)).map((hops) => ({ hops, score: scoreRoute(goal, hops, inventory), source: 'plotted' }));
  const saved = profileFor(profiles, goal);
  const fromProfile: Route[] = saved ? [{ hops: saved.hops, score: profileScore(saved), source: 'profile' }] : [];
  return [...fromProfile, ...plotted.sort((a, b) => b.score - a.score)].slice(0, ROUTE_LIMIT);
}

/** Where a route hop is on the current screen: its element's current centre, or fresh grounding when it is gone. */
export function resolveHop(h: RouteHop, inventory: InventoryElement[]): HopResolution {
  const e = findElement(inventory, h.name);
  return e ? { kind: 'inventory', ...boxCenter(e.box) } : { kind: 'ground', target: h.name };
}

/** A route as click steps the normal grounded pipeline runs (each names its element as the target). */
export const routeSteps = (route: Route): WorkflowStep[] =>
  route.hops.map((h, i) => ({ id: uid('route'), name: `Route ${i + 1}: ${h.via === 'start' ? 'click' : h.via} "${h.name}"`, action: 'click', target: h.name, x: h.x, y: h.y, status: 'pending' }));

/** Saves `hops` as the access-path profile of `goal` (replacing the same goal's, case-insensitive), newest first. */
export function saveProfile(profiles: RouteProfile[], goal: string, hops: RouteHop[], now = Date.now()): RouteProfile[] {
  if (!goal.trim() || !hops.length) return profiles;
  const old = profiles.find((p) => key(p.goal) === key(goal));
  const next: RouteProfile = { id: old?.id ?? uid('path'), goal: goal.trim(), hops, uses: old?.uses ?? 0, successes: old?.successes ?? 0, savedAt: now };
  return [next, ...profiles.filter((p) => p !== old)].slice(0, PROFILE_LIMIT);
}

/** Counts one use of the profile of `goal` and whether it reached the goal; unchanged when there is none. */
export const recordProfileResult = (profiles: RouteProfile[], goal: string, ok: boolean): RouteProfile[] =>
  profiles.map((p) => (key(p.goal) === key(goal) ? { ...p, uses: p.uses + 1, successes: p.successes + (ok ? 1 : 0) } : p));

/** One-line text of a route. */
export const routeText = (r: Route) => `${r.source === 'profile' ? 'saved path' : 'plotted'} (${r.score.toFixed(2)}): ${r.hops.map((h) => (h.via === 'start' ? `"${h.name}"` : `${h.via} "${h.name}"`)).join(' → ')}`;
