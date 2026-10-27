import { DEFAULT_DRIFT, matchTemplate, type DriftThresholds } from './drift.js';

/**
 * Live parallel drag: a swarm of lightweight coordinate agents, one per path segment, pre-computes
 * the drag path and keeps re-matching its waypoint on every live frame, so the executor always
 * moves to a predestined, corrected coordinate. The main AI may relocate a lost drop target once
 * and the user may re-aim or release at any time.
 */

type Point = { x: number; y: number };

/** Coordinate agents per drag (one per segment). */
export const SWARM_SIZE = 12;

/** One coordinate agent: the waypoint it owns, where it was planned and where it is now. */
export interface SwarmAgent {
  index: number;
  /** Fraction of the path this waypoint sits at (1 = the drop point). */
  t: number;
  /** The planned waypoint on the reference frame. */
  planned: Point;
  /** The live-corrected waypoint the executor moves to. */
  point: Point;
  /** Best-match distance of its region on the last live frame (0 = identical). */
  match: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Splits the path start → end into `n` agents, each owning the waypoint at the end of its segment. */
export function planSegments(start: Point, end: Point, n = SWARM_SIZE): SwarmAgent[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n;
    const p = lerp(start, end, t);
    return { index: i, t, planned: p, point: p, match: 0 };
  });
}

/** One agent's region re-matched on the live frame: its own correction when found, else null. */
function trackOne(ref: ImageData, live: ImageData, agent: SwarmAgent, drift: DriftThresholds) {
  const r = matchTemplate(ref, live, agent.planned.x, agent.planned.y, { radius: drift.radius });
  return { match: r.matchDistance, shift: r.matchDistance <= drift.matched ? { x: r.dx, y: r.dy } : null };
}

/**
 * Every agent re-matches its region of the reference frame on the live frame (in parallel).
 * A found region moves its waypoint by its own drift; a lost one follows the drop point's drift
 * scaled by its place on the path. `lost` is true when the drop point itself was not found.
 */
export function trackWaypoints(ref: ImageData, live: ImageData, agents: SwarmAgent[], drift: DriftThresholds = DEFAULT_DRIFT): { agents: SwarmAgent[]; lost: boolean } {
  const tracked = agents.map((a) => trackOne(ref, live, a, drift));
  const endShift = tracked[tracked.length - 1]?.shift ?? null;
  const next = agents.map((a, i) => {
    const shift = tracked[i].shift ?? (endShift ? { x: endShift.x * a.t, y: endShift.y * a.t } : { x: 0, y: 0 });
    return { ...a, match: tracked[i].match, point: { x: clamp01(a.planned.x + shift.x), y: clamp01(a.planned.y + shift.y) } };
  });
  return { agents: next, lost: endShift === null };
}

/** Re-plans the agents still ahead of `done` from `from` to a new drop point (an intervention or the AI's relocation). */
export function reaim(agents: SwarmAgent[], done: number, from: Point, end: Point): SwarmAgent[] {
  const ahead = agents.length - done;
  return agents.map((a, i) => {
    if (i < done) return a;
    const p = lerp(from, end, (i - done + 1) / ahead);
    return { ...a, planned: p, point: p };
  });
}

/** A press, a segment move or a release at a normalized point. */
export type DragInput = 'mouse_down' | 'move' | 'mouse_up';

/** What the user asked mid-drag: re-aim at a new drop point, or release at once. */
export type DragIntervention = { kind: 'aim'; point: Point } | { kind: 'release' };

/** What a live drag needs: the input sender, the live frames and the guardrail, AI and user hooks. */
export interface LiveDragDeps {
  start: Point;
  end: Point;
  /** The frame the path was planned on (drift buffer); null runs the planned path without live tracking. */
  ref: ImageData | null;
  agents?: number;
  drift?: DriftThresholds;
  /** Sends one input at a normalized point; resolves whether the PC performed it. */
  send: (input: DragInput, p: Point) => Promise<{ ok: boolean; message: string }>;
  /** The newest live frame (drift buffer), or null when none is available. */
  live: () => ImageData | null;
  /** Checked before every segment: a reason to stop (abort, disarm, Stop plan), or null to go on. */
  halt: () => string | null;
  /** Takes the user's pending intervention, if any. */
  intervention: () => DragIntervention | null;
  /** Main-AI freeflow: asked once to relocate the drop point when its agent loses it. */
  relocate?: (lostAt: Point) => Promise<Point | null>;
  onAgents?: (agents: SwarmAgent[]) => void;
  log?: (message: string) => void;
}

/** How a live drag ended. */
export interface LiveDragResult {
  ok: boolean;
  /** The button went down on the PC (false only when the press itself failed). */
  pressed: boolean;
  /** The pointer was released before the drop point (halt, intervention, failed move). */
  halted: boolean;
  message: string;
  /** Every point the pointer was moved to, press first. */
  path: Point[];
  /** Where the button was released. */
  releasedAt: Point;
}

/** Mutable progress of one live drag. */
interface DragRun {
  agents: SwarmAgent[];
  path: Point[];
  asked: boolean;
}

const at = (p: Point) => `(${(p.x * 100).toFixed(1)}%, ${(p.y * 100).toFixed(1)}%)`;

/** Releases the button at the current point and reports why. */
async function release(deps: LiveDragDeps, run: DragRun, ok: boolean, halted: boolean, message: string): Promise<LiveDragResult> {
  const here = run.path[run.path.length - 1];
  const up = await deps.send('mouse_up', here);
  const text = up.ok ? message : `${message}; release FAILED: ${up.message}`;
  return { ok: ok && up.ok, pressed: true, halted, message: text, path: run.path, releasedAt: here };
}

/** Applies the user's intervention; returns 'release' when the user asked to let go now. */
function intervene(deps: LiveDragDeps, run: DragRun, i: number): 'release' | null {
  const ask = deps.intervention();
  if (!ask) return null;
  if (ask.kind === 'release') return 'release';
  run.agents = reaim(run.agents, i, run.path[run.path.length - 1], ask.point);
  deps.log?.(`User re-aimed the drop point to ${at(ask.point)}`);
  return null;
}

/** Re-tracks every waypoint on the live frame; asks the main AI once when the drop point is lost. */
async function track(deps: LiveDragDeps, run: DragRun, i: number) {
  const live = deps.live();
  if (!live || !deps.ref) return;
  const out = trackWaypoints(deps.ref, live, run.agents, deps.drift);
  run.agents = out.agents;
  if (!out.lost || run.asked || !deps.relocate) return;
  run.asked = true;
  const drop = run.agents[run.agents.length - 1].planned;
  const found = await deps.relocate(drop).catch(() => null);
  if (!found) return deps.log?.(`Drop point lost at ${at(drop)} — the main AI could not relocate it; keeping the planned path`);
  run.agents = reaim(run.agents, i, run.path[run.path.length - 1], found);
  deps.log?.(`Drop point lost — the main AI relocated it to ${at(found)}`);
}

/**
 * Presses at the start, then for every segment: guardrail check, user intervention, live
 * re-tracking by the swarm, and one move to the segment's corrected waypoint; releases at the
 * drop point. Any halt, release request or failed move releases the button where the pointer is.
 */
export async function runLiveDrag(deps: LiveDragDeps): Promise<LiveDragResult> {
  const run: DragRun = { agents: planSegments(deps.start, deps.end, deps.agents ?? SWARM_SIZE), path: [deps.start], asked: false };
  const down = await deps.send('mouse_down', deps.start);
  if (!down.ok) return { ok: false, pressed: false, halted: true, message: `Press failed: ${down.message}`, path: run.path, releasedAt: deps.start };
  for (let i = 0; i < run.agents.length; i++) {
    const reason = deps.halt();
    if (reason) return release(deps, run, false, true, `${reason} — released after ${i} of ${run.agents.length} segment(s)`);
    if (intervene(deps, run, i) === 'release') return release(deps, run, false, true, `Released by the user after ${i} of ${run.agents.length} segment(s)`);
    await track(deps, run, i);
    deps.onAgents?.(run.agents);
    const next = run.agents[i].point;
    const moved = await deps.send('move', next);
    if (!moved.ok) return release(deps, run, false, true, `Segment ${i + 1} move failed: ${moved.message}`);
    run.path.push(next);
  }
  return release(deps, run, true, false, `Live drag: ${run.agents.length} segment(s) tracked by ${run.agents.length} coordinate agents, dropped at ${at(run.path[run.path.length - 1])}`);
}
