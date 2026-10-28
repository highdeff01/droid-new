import type { WorkflowStep } from './types.js';
import { POINTER_ACTIONS } from './types.js';
import { mappedAt } from './element-map-studio.js';
import { AGREE_DISTANCE, conflictsOf, crossReference, habitsFor, related, type Knowledge } from './cross-reference.js';
import { EXECUTION_MODES, type ExecutionMode } from './execution-mode.js';

type Point = { x: number; y: number };

/** Why a step may not dispatch: a blacklisted target+point, or coordinates the element map shows are stale. */
export interface GateBlock {
  kind: 'avoid' | 'stale';
  reason: string;
}

/** The AI-down circuit breaker: unresolved iterations in a row with the endpoint down, and why dispatch is paused. */
export interface Breaker {
  strikes: number;
  paused: string | null;
}

/** Unresolved iterations with the AI endpoint down before the run pauses. */
export const AI_DOWN_STRIKES = 2;
/** How often the AI endpoint is health-checked while the breaker holds the run paused, ms. */
export const AI_RECHECK_MS = 15_000;
/** How often a paused run looks whether it may resume, ms. */
export const PAUSE_POLL_MS = 250;
/** The run status while the breaker is open. */
export const AI_DOWN_PAUSE = 'paused: AI endpoint down; step needs re-grounding';
/** The run status while a mode that pauses dispatch is selected. */
export const MODE_PAUSE = 'paused: Watching mode — pack/workflow dispatches wait until another mode is selected';
/** A closed breaker: no strikes, not paused. */
export const BREAKER_IDLE: Breaker = { strikes: 0, paused: null };

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const COORDS = /\((\d+(?:\.\d+)?)%,\s*(\d+(?:\.\d+)?)%\)/g;
const targetOf = (step: WorkflowStep) => step.target ?? step.name;
/** Where the step will dispatch: its corrected point, else its planned one. */
export const dispatchPoint = (step: WorkflowStep): Point => ({ x: step.correctedX ?? step.x, y: step.correctedY ?? step.y });

/** The identity of a dispatch: its target and point rounded to whole percent. */
export function dispatchKey(step: WorkflowStep): string {
  const p = dispatchPoint(step);
  return `${targetOf(step).trim().toLowerCase()}@${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
}

/** The points an avoid entry names, as "(x%, y%)"; empty when it names none. */
export const avoidPoints = (text: string): Point[] => [...text.matchAll(COORDS)].map((m) => ({ x: Number(m[1]) / 100, y: Number(m[2]) / 100 }));

/** Whether an avoid entry covers `p`: it names no point (the whole target), or one within AGREE_DISTANCE. */
const covers = (text: string, p: Point) => {
  const points = avoidPoints(text);
  return !points.length || points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= AGREE_DISTANCE);
};

/** Folded name: lower case, single spaces. */
const fold = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
/** Whether `text` names `target`: a shared meaningful word, or the target's full name (short names like "Click 6" have no meaningful word). */
const names = (text: string, target: string) => related(target, text) || (!!fold(target) && fold(text).includes(fold(target)));

/** Avoid entries for this target: habit avoid lessons (this target, this context) and learned avoid patterns naming it. */
const avoidEntries = (target: string, k: Knowledge): string[] => [
  ...habitsFor(target, k).flatMap((h) => h.lessons.filter((l) => l.kind === 'avoid').map((l) => `Habit avoid: ${l.text}`)),
  ...k.patterns.filter((pt) => pt.kind === 'avoid' && names(pt.pattern, target)).map((pt) => `Learned avoid: ${pt.pattern}`),
];

/** The first habit avoid lesson or learned avoid pattern that blacklists this target at this point. */
function avoidBlock(target: string, p: Point, k: Knowledge): GateBlock | null {
  const hit = avoidEntries(target, k).find((text) => covers(text, p));
  return hit ? { kind: 'avoid', reason: `blacklisted — ${hit}` } : null;
}

/** A mapped element covering the point that is not the step's target: the coordinates are stale. */
function staleBlock(target: string, p: Point, k: Knowledge): GateBlock | null {
  const covering = mappedAt(k.map, p);
  if (!covering || names(covering.name, target) || names(target, covering.name)) return null;
  return { kind: 'stale', reason: `stale coordinates — mapped element "${covering.name}" covers (${pct(p.x)}, ${pct(p.y)}), not "${target}"` };
}

/**
 * Dispatch-time gate of `step` against what is known: an active avoid entry for its target at its
 * point blocks it; so does, for a pointer step whose point was not re-grounded, a mapped element at
 * the point that is not its target. Null when it may dispatch.
 */
export function gateStep(step: WorkflowStep, k: Knowledge, checkStale: boolean): GateBlock | null {
  const target = targetOf(step);
  const p = dispatchPoint(step);
  const avoid = avoidBlock(target, p, k);
  if (avoid) return avoid;
  return checkStale && POINTER_ACTIONS.has(step.action) ? staleBlock(target, p, k) : null;
}

/** Every conflict the cross-reference finds for the step at its point, as one line for the planner. */
export const conflictDetails = (step: WorkflowStep, k: Knowledge) => conflictsOf(crossReference(targetOf(step), dispatchPoint(step), k)).map((c) => c.text).join('; ');

/**
 * One more unresolved iteration: counted only with the AI endpoint down; the breaker opens at
 * AI_DOWN_STRIKES, or at once for a `hard` strike (stale coordinates nothing can re-ground).
 */
export function strike(b: Breaker, online: boolean, hard = false): Breaker {
  if (online || b.paused) return b;
  const strikes = hard ? AI_DOWN_STRIKES : b.strikes + 1;
  return { strikes, paused: strikes >= AI_DOWN_STRIKES ? AI_DOWN_PAUSE : null };
}

/** Why pack/workflow dispatch is paused now: the execution mode, else the breaker; null when it may run. */
export const pauseReason = (mode: ExecutionMode, b: Breaker): string | null => (EXECUTION_MODES[mode].pausesDispatch ? MODE_PAUSE : b.paused);

/** What a mode change does to pack/workflow dispatch, appended to its log line; empty when nothing changes. */
export function modePauseText(from: ExecutionMode, to: ExecutionMode): string {
  const was = EXECUTION_MODES[from].pausesDispatch;
  const now = EXECUTION_MODES[to].pausesDispatch;
  if (was === now) return '';
  return now ? ' — pack/workflow dispatches paused (the in-flight step finishes first)' : ' — pack/workflow dispatches resumed';
}
