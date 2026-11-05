import type { Frame, WorkflowStep } from './types.js';
import { POINTER_ACTIONS } from './types.js';
import type { Box } from './assist-ai.js';
import { AGREE_DISTANCE, habitsFor, related, type Knowledge } from './cross-reference.js';
import { isReliable } from './habits.js';
import { boxCenter } from './element-map-studio.js';
import { zoomBox } from './grounding.js';

type Point = { x: number; y: number };

/** Where an alternate access path to a target comes from, in rank order. */
export type PathSource = 'mapped' | 'learned' | 'habit';

/** One known alternate point to reach a target. */
export interface AccessPath extends Point {
  source: PathSource;
  name: string;
}

/** How a reroute resolved: re-identified on a fresh snip, an alternate path, a re-plan, or none (the step runs on). */
export type RerouteKind = 'resnip' | 'alternate' | 'replan' | 'none';

/** The reroute decision shown in the pre-action briefing before the step dispatches. */
export interface RerouteDecision {
  kind: RerouteKind;
  step: WorkflowStep;
  text: string;
  /** The fresh snip of the target region the decision was made on, when one was taken. */
  snip?: Frame;
}

/** What a reroute routes through. */
export interface RerouteDeps {
  /** The AI endpoint is reachable (re-identification and re-planning need it). */
  online: boolean;
  knowledge: Knowledge;
  /** A fresh snip of `box` on the live screen; null when there is no live screen. */
  snip: (box: Box) => Promise<Frame | null>;
  /** Re-identifies the step's target on the snip of `box`; the point is on the full screen, null when not visible. */
  identify: (step: WorkflowStep, snip: Frame, box: Box) => Promise<Point | null>;
  /** The planner's re-plan of the step; absent when the caller re-plans itself. */
  replan?: (step: WorkflowStep, why: string) => Promise<WorkflowStep | null>;
}

/** Share of the screen width the target-region snip spans. */
export const REROUTE_SHARE = 0.3;

const RANK: Record<PathSource, number> = { mapped: 0, learned: 1, habit: 2 };
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const at = (p: Point) => `(${pct(p.x)}, ${pct(p.y)})`;
const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) <= AGREE_DISTANCE;
const targetOf = (step: WorkflowStep) => step.target ?? step.name;
const planned = (step: WorkflowStep): Point => ({ x: step.correctedX ?? step.x, y: step.correctedY ?? step.y });

/** The region around the step's planned point that a reroute snips fresh. */
export const targetRegion = (step: WorkflowStep, aspect = 16 / 9): Box => zoomBox(planned(step), aspect, REROUTE_SHARE);

/** A point on a snip of `box` as a point on the full screen. */
export const fromSnip = (box: Box, p: Point): Point => ({ x: box.x + p.x * box.w, y: box.y + p.y * box.h });

/** A point on the full screen as a point on a snip of `box`. */
export const toSnip = (box: Box, p: Point): Point => ({ x: (p.x - box.x) / box.w, y: (p.y - box.y) / box.h });

/** Every known point of `target`, unranked: mapped boundaries, familiar elements, reliable habit anchors. */
function knownPoints(target: string, k: Knowledge): AccessPath[] {
  const mapped = k.map.filter((e) => related(target, e.name)).map((e): AccessPath => ({ source: 'mapped', name: e.name, ...boxCenter(e.box) }));
  const learned = k.familiar.filter((f) => related(target, f.name)).map((f): AccessPath => ({ source: 'learned', name: f.name, x: f.x, y: f.y }));
  const habits = habitsFor(target, k).filter((h) => h.anchor && isReliable(h)).map((h): AccessPath => ({ source: 'habit', name: h.target, x: h.anchor!.x, y: h.anchor!.y }));
  return [...mapped, ...learned, ...habits];
}

/**
 * The alternate access paths to `target` from what is already known, ranked mapped > learned >
 * habit: points within AGREE_DISTANCE of the failed point, or of a better-ranked path, are dropped.
 */
export function accessPaths(target: string, failed: Point, k: Knowledge): AccessPath[] {
  const ranked = knownPoints(target, k).sort((a, b) => RANK[a.source] - RANK[b.source]);
  const out: AccessPath[] = [];
  for (const p of ranked) if (!near(p, failed) && !out.some((q) => near(p, q))) out.push(p);
  return out;
}

/** The step re-pointed at `p`; its stale template and drift correction are dropped. */
const pointedAt = (step: WorkflowStep, p: Point): WorkflowStep => ({ ...step, x: p.x, y: p.y, refFrame: undefined, correctedX: undefined, correctedY: undefined, unlocated: false });

/** One route: null when it does not apply or finds nothing. */
type Route = (step: WorkflowStep, why: string, deps: RerouteDeps) => Promise<RerouteDecision | null>;

const resnip: Route = async (step, _why, deps) => {
  if (!deps.online) return null;
  const box = targetRegion(step);
  const snip = await deps.snip(box);
  if (!snip) return null;
  const p = await deps.identify(step, snip, box);
  if (!p || near(p, planned(step))) return null;
  return { kind: 'resnip', step: pointedAt(step, p), snip, text: `Snipped the target region fresh and re-identified "${targetOf(step)}" at ${at(p)}` };
};

const alternate: Route = async (step, _why, deps) => {
  const path = accessPaths(targetOf(step), planned(step), deps.knowledge)[0];
  if (!path) return null;
  return { kind: 'alternate', step: pointedAt(step, path), text: `Alternate access path: ${path.source} "${path.name}" at ${at(path)}` };
};

const replan: Route = async (step, why, deps) => {
  if (!deps.online || !deps.replan) return null;
  const next = await deps.replan(step, why);
  return next && { kind: 'replan', step: next, text: `Re-planned mid-run: ${next.action} "${targetOf(next)}" at ${at(planned(next))}` };
};

/** Reroute order: re-identify on a fresh snip, then the best alternate access path, then the planner's re-plan. */
const ROUTES: readonly Route[] = [resnip, alternate, replan];
/** A step with no on-screen target has nothing to snip or reach another way: only the re-plan applies. */
const OFFSCREEN_ROUTES: readonly Route[] = [replan];

/**
 * Reroutes a step whose grounding or briefing comparison failed (`why`) without stopping the run:
 * the first route that finds a new point or step wins; with none the step runs on as planned.
 * A failing route (endpoint error, no snip) counts as finding nothing.
 */
export async function reroute(step: WorkflowStep, why: string, deps: RerouteDeps): Promise<RerouteDecision> {
  for (const route of POINTER_ACTIONS.has(step.action) ? ROUTES : OFFSCREEN_ROUTES) {
    const decision = await route(step, why, deps).catch(() => null);
    if (decision) return decision;
  }
  return { kind: 'none', step, text: `No reroute for "${targetOf(step)}" — no fresh identification, alternate path or re-plan; running it as planned` };
}
