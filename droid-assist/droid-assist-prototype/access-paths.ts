import type { LogEntry, WorkflowStep } from './types.js';
import type { HabitOutcome } from './habits.js';
import { similarity, uid } from './planner.js';

/** Most access-path profiles kept. */
export const ACCESS_PATH_LIMIT = 100;
/** Versions kept per profile: the current one and the older paths with their frequency. */
export const PATH_VERSION_LIMIT = 5;
/** Two hops at the same label within this normalized distance are the same hop. */
export const PATH_TOLERANCE = 0.02;
/** Uses before a path's success rate is judged. */
export const PATH_MIN_USES = 3;
/** A judged path below this success rate is not tried as a fast path. */
export const PATH_RELIABLE_RATE = 0.5;
/** Profiles sent with one planning ask. */
export const PATH_CONTEXT_LIMIT = 4;

/** The pointer actions a hop (and a fast-path step) can be. */
export type HopAction = 'click' | 'double_click';
const HOP_ACTIONS: readonly HopAction[] = ['click', 'double_click'];

/** Whether a step action can be a hop (and so be reached by a saved path). */
export const isHopAction = (a: string): a is HopAction => HOP_ACTIONS.includes(a as HopAction);

/** One hop on the way to a target: what is clicked and where (normalized 0..1). */
export interface PathHop {
  label: string;
  action: HopAction;
  x: number;
  y: number;
}

/** One version of a target's path and how often it was used and worked. */
export interface PathVersion {
  version: number;
  hops: PathHop[];
  uses: number;
  successes: number;
  savedAt: number;
  lastUsed: number;
}

/** The access-path profile of one target in one app/window context; versions[0] is the current path. */
export interface AccessProfile {
  id: string;
  target: string;
  context: string;
  versions: PathVersion[];
}

/** The minimum of a step result the fast path reads. */
export interface HopOutcome {
  ok: boolean;
  executed: boolean;
  message: string;
  target: { x: number; y: number };
  halt?: boolean;
  check?: { changed: boolean };
}

/** How a target was reached: by its saved path, by fresh grounding after the path failed, or fresh (no usable path). */
export interface Reach<O extends HopOutcome> {
  via: 'path' | 'fallback' | 'fresh';
  out: O;
  /** Index (in the current version's hops) of the hop that failed. */
  failedHop?: number;
}

/** The result of running a path's hops in order. */
export interface PathRun<O extends HopOutcome> {
  ok: boolean;
  last: O | null;
  failedHop?: number;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const isFiniteIn01 = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

/** The current path of a profile. */
export const currentPath = (p: AccessProfile) => p.versions[0];

/** Successes over uses of a version; 0 before its first use. */
export const pathRate = (v: PathVersion) => (v.uses ? v.successes / v.uses : 0);

const sameProfile = (p: AccessProfile, target: string, context: string) => norm(p.target) === norm(target) && norm(p.context) === norm(context);

const sameHop = (a: PathHop, b: PathHop) => norm(a.label) === norm(b.label) && a.action === b.action && Math.hypot(a.x - b.x, a.y - b.y) <= PATH_TOLERANCE;

/** Whether two hop lists are the same path (same labels and actions, points within PATH_TOLERANCE). */
export const samePath = (a: PathHop[], b: PathHop[]) => a.length === b.length && a.every((h, i) => sameHop(h, b[i]));

/** `p` with `version` first, at most PATH_VERSION_LIMIT versions. */
const withCurrent = (p: AccessProfile, version: PathVersion): AccessProfile => ({ ...p, versions: [version, ...p.versions.filter((v) => v.version !== version.version)].slice(0, PATH_VERSION_LIMIT) });

const nextVersion = (p: AccessProfile) => Math.max(0, ...p.versions.map((v) => v.version)) + 1;

/** `profiles` with `p` first (replacing its old entry), at most ACCESS_PATH_LIMIT. */
const touch = (profiles: AccessProfile[], p: AccessProfile) => [p, ...profiles.filter((x) => x.id !== p.id)].slice(0, ACCESS_PATH_LIMIT);

/** The version of `p` whose hops are `hops`, made current: a matching version is promoted (hops refreshed), otherwise a new version is added. */
function currentWith(p: AccessProfile, hops: PathHop[], now: number, used: { uses: number; successes: number }): AccessProfile {
  const match = p.versions.find((v) => samePath(v.hops, hops));
  const base = match ?? { version: nextVersion(p), hops, uses: 0, successes: 0, savedAt: now, lastUsed: now };
  return withCurrent(p, { ...base, hops, uses: base.uses + used.uses, successes: base.successes + used.successes, lastUsed: now });
}

/**
 * Remembers a path that reached its target: the same path counts one more successful use; a
 * changed path becomes the new current version and the old one is kept with its frequency.
 * A blank target or an empty path changes nothing.
 */
export function rememberPath(profiles: AccessProfile[], path: { target: string; context: string; hops: PathHop[] }, now = Date.now()): AccessProfile[] {
  if (!path.target.trim() || !path.hops.length) return profiles;
  const found = profiles.find((p) => sameProfile(p, path.target, path.context)) ?? { id: uid('path'), target: path.target.trim(), context: path.context.trim(), versions: [] };
  return touch(profiles, currentWith(found, path.hops, now, { uses: 1, successes: 1 }));
}

/** Counts one use (and success) of the current path of profile `id`. */
export function recordPathResult(profiles: AccessProfile[], id: string, success: boolean, now = Date.now()): AccessProfile[] {
  return profiles.map((p) => (p.id === id && p.versions.length ? withCurrent(p, { ...currentPath(p), uses: currentPath(p).uses + 1, successes: currentPath(p).successes + (success ? 1 : 0), lastUsed: now }) : p));
}

/** A hand edit of profile `id`'s path: the same path keeps its counts, a changed one becomes a new unused version. An empty path changes nothing. */
export function editPath(profiles: AccessProfile[], id: string, hops: PathHop[], now = Date.now()): AccessProfile[] {
  const found = profiles.find((p) => p.id === id);
  if (!found || !hops.length) return profiles;
  return profiles.map((p) => (p === found ? currentWith(p, hops, now, { uses: 0, successes: 0 }) : p));
}

/** Drops profile `id`. */
export const deletePath = (profiles: AccessProfile[], id: string) => profiles.filter((p) => p.id !== id);

/** False once the current path has PATH_MIN_USES uses and its rate is strictly below PATH_RELIABLE_RATE. */
export const isReliablePath = (p: AccessProfile) => currentPath(p).uses < PATH_MIN_USES || pathRate(currentPath(p)) >= PATH_RELIABLE_RATE;

/** The reliable profile of (target, context) to try as a fast path, or null. */
export function usablePath(profiles: AccessProfile[], target: string, context: string): AccessProfile | null {
  return profiles.find((p) => sameProfile(p, target, context) && p.versions.length > 0 && isReliablePath(p)) ?? null;
}

/**
 * The hops still to run, as steps with their index in the current path. Hops up to the last one
 * whose label matches an element already reached in this run are skipped; the final hop (the
 * target itself) always runs. Steps carry no target name, so they run at their saved points
 * without re-planning or AI grounding.
 */
export function pathSteps(p: AccessProfile, reached: string[]): { index: number; step: WorkflowStep }[] {
  const hops = currentPath(p).hops;
  const done = new Set(reached.map(norm));
  let from = 0;
  hops.slice(0, -1).forEach((h, i) => {
    if (done.has(norm(h.label))) from = i + 1;
  });
  return hops.slice(from).map((h, k) => {
    const index = from + k;
    return { index, step: { id: uid('path'), name: `Path to "${p.target}" hop ${index + 1}/${hops.length}: ${h.label}`, action: h.action, x: h.x, y: h.y, status: 'pending' } };
  });
}

/** A hop failed when it did not run, or ran and changed nothing on screen. */
export const hopFailed = (out: HopOutcome) => !out.ok || (out.executed && out.check?.changed === false);

/** Runs the hops in order; stops at the first failing one. */
export async function runPath<O extends HopOutcome>(hops: { index: number; step: WorkflowStep }[], runHop: (s: WorkflowStep) => Promise<O>): Promise<PathRun<O>> {
  let last: O | null = null;
  for (const { index, step } of hops) {
    last = await runHop(step);
    if (hopFailed(last)) return { ok: false, last, failedHop: index };
  }
  return { ok: true, last };
}

/** What reaching a target needs from its host. */
export interface ReachDeps<O extends HopOutcome> {
  /** Runs one hop step (no grounding, no re-plan). */
  runHop: (s: WorkflowStep) => Promise<O>;
  /** Fresh grounding of the original step. */
  fallback: () => Promise<O>;
  /** Elements already reached in this run (their hops are skipped). */
  reached: string[];
  log: (message: string, tone: LogEntry['tone']) => void;
}

/**
 * Reaches a step's target: the saved access path first (fast, no re-planning); when a hop fails
 * the step falls back to fresh grounding. A halted hop (abort, disarm gate, budget) does not fall back.
 */
export async function reachTarget<O extends HopOutcome>(step: WorkflowStep, profile: AccessProfile | null, deps: ReachDeps<O>): Promise<Reach<O>> {
  if (!profile) return { via: 'fresh', out: await deps.fallback() };
  const v = currentPath(profile);
  const hops = pathSteps(profile, deps.reached);
  deps.log(`"${step.name}": saved access path v${v.version} — ${hops.map(({ step: s }) => s.name.split(': ').pop()).join(' → ')}`, 'info');
  const run = await runPath(hops, deps.runHop);
  if (run.ok && run.last) {
    deps.log(`"${step.name}": reached "${profile.target}" by its saved path — no re-planning`, 'ok');
    return { via: 'path', out: { ...run.last, message: `${run.last.message} (saved access path v${v.version})` } };
  }
  const failed = v.hops[run.failedHop!];
  if (run.last?.halt) return { via: 'path', out: run.last, failedHop: run.failedHop };
  deps.log(`"${step.name}": saved path failed at hop ${run.failedHop! + 1} "${failed.label}" (${run.last?.message ?? 'no result'}) — falling back to fresh grounding`, 'warn');
  return { via: 'fallback', out: await deps.fallback(), failedHop: run.failedHop };
}

/** The repaired path after fresh grounding reached the target at `p`: the hops before the failed one, then the target at `p`. */
export function repairedHops(hops: PathHop[], failedHop: number, p: { x: number; y: number }): PathHop[] {
  const last = hops[hops.length - 1];
  return [...hops.slice(0, Math.min(failedHop, hops.length - 1)), { ...last, x: p.x, y: p.y }];
}

/**
 * The profiles after a reach: a path run counts as one use of the current version (success
 * when it reached the target); a fallback that then reached the target saves the repaired path
 * as the new version. A fresh reach or a halt changes nothing.
 */
export function applyReach<O extends HopOutcome>(profiles: AccessProfile[], profile: AccessProfile, reach: Reach<O>, now = Date.now()): AccessProfile[] {
  if (reach.via === 'fresh' || (reach.via === 'path' && reach.out.halt)) return profiles;
  const counted = recordPathResult(profiles, profile.id, reach.via === 'path' && reach.out.ok, now);
  if (reach.via === 'path' || !reach.out.ok || reach.failedHop === undefined) return counted;
  const hops = repairedHops(currentPath(profile).hops, reach.failedHop, reach.out.target);
  return rememberPath(counted, { target: profile.target, context: profile.context, hops }, now);
}

/** A path's success or failure as a habit update of its target (failure carries an avoid lesson naming the hop). */
export function pathOutcome(profile: AccessProfile, ok: boolean, failedHop?: number): HabitOutcome {
  const v = currentPath(profile);
  const hop = failedHop === undefined ? undefined : v.hops[failedHop];
  return { target: profile.target, context: profile.context, success: ok, avoid: ok ? null : `saved access path v${v.version}${hop ? ` — hop "${hop.label}" failed` : ''}` };
}

/**
 * Learns access paths from a finished run: every done click on a named target gets the path of
 * done clicks that led to it (in run order) as its profile.
 */
export function learnPaths(profiles: AccessProfile[], steps: WorkflowStep[], context: string, now = Date.now()): AccessProfile[] {
  let hops: PathHop[] = [];
  let next = profiles;
  for (const s of steps) {
    if (s.status !== 'done' || !isHopAction(s.action)) continue;
    hops = [...hops, { label: s.target ?? s.name, action: s.action, x: s.correctedX ?? s.x, y: s.correctedY ?? s.y }];
    if (s.target?.trim()) next = rememberPath(next, { target: s.target, context, hops }, now);
  }
  return next;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** One hop as editable text: `label @ x%, y%`, with ` ×2` for a double click. */
export const hopText = (h: PathHop) => `${h.label} @ ${pct(h.x)}, ${pct(h.y)}${h.action === 'double_click' ? ' ×2' : ''}`;

const HOP_LINE = /^(.+?)\s*@\s*(-?[\d.]+)\s*%?\s*,\s*(-?[\d.]+)\s*%?\s*(×2|x2)?$/i;

/** Parses one hop per line in hopText format; null when any line is not a hop on screen or there is none. */
export function parseHops(text: string): PathHop[] | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const hops = lines.map((l): PathHop | null => {
    const m = HOP_LINE.exec(l);
    if (!m) return null;
    const x = Number(m[2]) / 100;
    const y = Number(m[3]) / 100;
    return isFiniteIn01(x) && isFiniteIn01(y) ? { label: m[1].trim(), action: m[4] ? 'double_click' : 'click', x, y } : null;
  });
  return hops.length && hops.every((h) => h !== null) ? (hops as PathHop[]) : null;
}

/** A profile as one planning-context line: the hops with their points, version and rate. */
export function pathLine(p: AccessProfile): string {
  const v = currentPath(p);
  return `[Path] to reach "${p.target}"${p.context ? ` in ${p.context}` : ''}: ${v.hops.map(hopText).join(' → ')} (v${v.version}, ${v.successes}/${v.uses} ok)`;
}

/** The reliable profiles in `context` whose target shares a meaningful word with `goal`, most used first. */
export function relevantPaths(goal: string, context: string, profiles: AccessProfile[]): AccessProfile[] {
  return profiles
    .filter((p) => p.versions.length > 0 && isReliablePath(p) && norm(p.context) === norm(context) && similarity(p.target, goal) > 0)
    .sort((a, b) => currentPath(b).uses - currentPath(a).uses)
    .slice(0, PATH_CONTEXT_LIMIT);
}

function isHop(v: unknown): v is PathHop {
  return isObject(v) && typeof v.label === 'string' && !!v.label.trim() && typeof v.action === 'string' && isHopAction(v.action) && isFiniteIn01(v.x) && isFiniteIn01(v.y);
}

function isVersion(v: unknown): v is PathVersion {
  return isObject(v) && isCount(v.version) && Array.isArray(v.hops) && v.hops.length > 0 && v.hops.every(isHop)
    && isCount(v.uses) && isCount(v.successes) && v.successes <= v.uses && isTime(v.savedAt) && isTime(v.lastUsed);
}

/** A valid stored profile: a named target with at least one valid version. */
export function isAccessProfile(v: unknown): v is AccessProfile {
  return isObject(v) && typeof v.id === 'string' && !!v.id && typeof v.target === 'string' && !!v.target.trim() && typeof v.context === 'string'
    && Array.isArray(v.versions) && v.versions.length > 0 && v.versions.length <= PATH_VERSION_LIMIT && v.versions.every(isVersion);
}
