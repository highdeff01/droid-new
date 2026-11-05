import { uid } from './planner.js';
import type { PortfolioEntry, PortfolioSource } from './portfolio.js';
import type { StepStatus, WorkflowStep } from './types.js';

/**
 * Background portfolio variations: when a goal is superseded (or the user starts a new
 * variation) the previous goal and its steps keep running as a separate background variation.
 * Each variation owns its record here and its portfolio entries under its own actor, and every
 * update touches only the variation it names, so sibling variations are never clobbered.
 */

/**
 * running: its steps are worked in the background; paused: held until resumed; done/failed: finished;
 * merged: folded back into the main project; discarded: dropped by the user. Merged and discarded are closed:
 * the variation stays listed for the record but never runs or changes again.
 */
export type VariationStatus = 'running' | 'paused' | 'done' | 'failed' | 'merged' | 'discarded';
export const VARIATION_STATUSES: readonly VariationStatus[] = ['running', 'paused', 'done', 'failed', 'merged', 'discarded'];

/** The statuses a variation ends in by a user decision. */
export type ClosedStatus = Extract<VariationStatus, 'merged' | 'discarded'>;

/** Whether `v` was merged or discarded and so never runs or changes again. */
export const isClosed = (v: Variation): boolean => v.status === 'merged' || v.status === 'discarded';

export interface Variation {
  id: string;
  goal: string;
  /** Its own copy of the steps (screenshots dropped), with their run status. */
  steps: WorkflowStep[];
  status: VariationStatus;
  /** Why it went to the background, or why it last paused/failed. */
  reason: string;
  created: number;
  updated: number;
}

/** Most variations kept (newest first). */
export const VARIATION_LIMIT = 20;

const ACTOR_PREFIX = 'variation:';

/** The portfolio actor that holds variation `id`'s record (goal, steps, notes, learned methods). */
export const variationActor = (id: string) => `${ACTOR_PREFIX}${id}`;

/** The portfolio source of work done for `v`. */
export const variationSource = (v: Variation): PortfolioSource => ({ operation: v.goal, opId: variationActor(v.id) });

/** A step as a variation keeps it: no screenshot, and a step that was mid-run is pending again. */
const ownStep = ({ refFrame: _frame, ...s }: WorkflowStep): WorkflowStep => ({ ...s, status: s.status === 'running' ? 'pending' : s.status });

/** A new running variation of `goal` holding a copy of `steps`. */
export function createVariation(goal: string, steps: WorkflowStep[], reason: string, time = Date.now()): Variation {
  return { id: uid('var'), goal: goal.trim(), steps: steps.map(ownStep), status: 'running', reason, created: time, updated: time };
}

/** Adds `v` newest first, capped at VARIATION_LIMIT; the oldest closed variations make room before any open one. */
export function addVariation(list: Variation[], v: Variation): Variation[] {
  const all = [v, ...list];
  const excess = all.length - VARIATION_LIMIT;
  if (excess <= 0) return all;
  const dropped = new Set(all.filter(isClosed).slice(-excess).map((x) => x.id));
  return all.filter((x) => !dropped.has(x.id)).slice(0, VARIATION_LIMIT);
}

/** Closes `v` as merged or discarded, keeping its steps for the record. */
export const closeVariation = (v: Variation, status: ClosedStatus, reason: string, time = Date.now()): Variation =>
  ({ ...v, status, reason, updated: time });

/** Applies `fn` to variation `id` only; every sibling is returned unchanged (same object). */
export const updateVariation = (list: Variation[], id: string, fn: (v: Variation) => Variation): Variation[] =>
  list.map((v) => (v.id === id ? fn(v) : v));

export const removeVariation = (list: Variation[], id: string): Variation[] => list.filter((v) => v.id !== id);

/** Index of the next step `v` has to run, or -1. */
export const nextStepIndex = (v: Variation): number => v.steps.findIndex((s) => s.status === 'pending');

/** The running variation whose turn it is: the one updated longest ago that still has a step to run. */
export function nextRunnable(list: Variation[]): Variation | null {
  const ready = list.filter((v) => v.status === 'running' && nextStepIndex(v) >= 0);
  return ready.reduce<Variation | null>((a, v) => (!a || v.updated < a.updated ? v : a), null);
}

/** Records one background step's outcome: a failure pauses the variation, the last success finishes it. */
export function applyStepResult(v: Variation, index: number, ok: boolean, message: string, time = Date.now()): Variation {
  const status: StepStatus = ok ? 'done' : 'failed';
  const steps = v.steps.map((s, i) => (i === index ? { ...s, status } : s));
  const next: Variation = { ...v, steps, updated: time };
  if (!ok) return { ...next, status: 'paused', reason: `"${v.steps[index].name}" failed: ${message}` };
  return steps.some((s) => s.status === 'pending') ? next : { ...next, status: 'done', reason: 'All steps done' };
}

/** Pauses `v`, keeping its place. */
export const pauseVariation = (v: Variation, reason: string, time = Date.now()): Variation => ({ ...v, status: 'paused', reason, updated: time });

/** Resumes `v`: failed steps are retried; a variation with nothing left to run stays done. */
export function resumeVariation(v: Variation, time = Date.now()): Variation {
  const steps = v.steps.map((s) => (s.status === 'failed' || s.status === 'drift' ? { ...s, status: 'pending' as const } : s));
  const pending = steps.some((s) => s.status === 'pending');
  return { ...v, steps, status: pending ? 'running' : 'done', reason: pending ? 'Resumed' : 'All steps done', updated: time };
}

const stepKey = (s: WorkflowStep) => `${s.action}|${(s.target ?? s.name).trim().toLowerCase()}|${s.text ?? ''}`;

/** The main steps followed by the variation's steps the main project does not have yet (fresh ids on collision). */
export function mergeSteps(main: WorkflowStep[], variation: WorkflowStep[]): WorkflowStep[] {
  const keys = new Set(main.map(stepKey));
  const ids = new Set(main.map((s) => s.id));
  const added = variation.filter((s) => !keys.has(stepKey(s))).map((s) => (ids.has(s.id) ? { ...s, id: uid('step') } : s));
  return [...main, ...added];
}

/** Re-attributes variation `id`'s portfolio entries to `source` (the main project's operation); others untouched. */
export const reattributePortfolio = (entries: PortfolioEntry[], id: string, source: PortfolioSource): PortfolioEntry[] =>
  entries.map((e) => (e.actor === variationActor(id) ? { ...e, source } : e));

/** Drops variation `id`'s portfolio entries only. */
export const forgetPortfolio = (entries: PortfolioEntry[], id: string): PortfolioEntry[] => entries.filter((e) => e.actor !== variationActor(id));

/** One line describing `steps`, for the variation's portfolio record. */
export const stepsLine = (steps: WorkflowStep[]) => steps.map((s) => `${s.action} "${s.target ?? s.name}"`).join(' → ') || 'no steps';

/** The record's text written when a variation is created. */
export const variationRecord = (v: Variation) => `Goal "${v.goal}" — ${v.steps.length} step(s): ${stepsLine(v.steps)} (${v.reason})`;

/** The learned method a finished variation records: the steps that worked, in order. */
export const learnedMethod = (v: Variation) => `For "${v.goal}": ${stepsLine(v.steps.filter((s) => s.status === 'done'))}`;
