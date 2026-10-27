import { useCallback, useEffect, useRef, useState } from 'react';
import { createBudget, type ActionBudget } from './safety.js';
import type { PortfolioKind, PortfolioSource } from './portfolio.js';
import type { LogEntry, WorkflowStep } from './types.js';
import { loadVariations, saveVariations } from './storage.js';
import {
  addVariation, applyStepResult, createVariation, learnedMethod, mergeSteps, nextRunnable, nextStepIndex, pauseVariation, removeVariation,
  resumeVariation, updateVariation, variationActor, variationRecord, variationSource, type Variation,
} from './variations.js';

/** How often a background variation may run its next step. */
export const VARIATION_TICK_MS = 1500;

/** The outcome of one background step run through the engine's gated execution path. */
export interface VariationStepOutcome {
  ok: boolean;
  message: string;
}

/** What the variations hook reads from and drives in the assist engine. */
export interface VariationDeps {
  /** The main project: its goal and steps. */
  main: () => { goal: string; steps: WorkflowStep[] };
  /** Replaces the main project's goal and steps. */
  setMain: (goal: string, steps: WorkflowStep[]) => void;
  /** Why background real-input work must wait now (guardrails, main executor busy), or null. */
  blocked: () => string | null;
  /** Runs one step of a variation through the gated execution path, spending `budget`. */
  runStep: (step: WorkflowStep, actor: string, budget: ActionBudget) => Promise<VariationStepOutcome>;
  /** The per-run action budget limit from the settings. */
  budgetLimit: () => number;
  log: (message: string, tone: LogEntry['tone']) => void;
  /** Writes one entry into `actor`'s portfolio under `source`. */
  record: (actor: string, kind: PortfolioKind, text: string, source: PortfolioSource, ok?: boolean) => void;
  /** Re-attributes a variation's portfolio entries to the main operation. */
  mergeRecords: (id: string, source: PortfolioSource) => void;
  /** Drops a variation's portfolio entries. */
  forgetRecords: (id: string) => void;
}

/**
 * Background portfolio variations: superseded goals keep running in the background, one step
 * per tick, each under its own action budget and only while no guardrail holds them; the user
 * can pause, resume, switch focus, merge back into the main project, or discard.
 */
export function useVariations(deps: VariationDeps) {
  const [variations, setVariationsState] = useState<Variation[]>(loadVariations);
  /** Why background work is waiting right now, or null while it may run. */
  const [held, setHeld] = useState<string | null>(null);
  const listRef = useRef(variations);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const busyRef = useRef(false);
  const budgetsRef = useRef(new Map<string, ActionBudget>());

  useEffect(() => saveVariations(variations), [variations]);

  /** Updates the list and its ref together, so a tick reads what the last change wrote. */
  const change = useCallback((fn: (list: Variation[]) => Variation[]) => {
    listRef.current = fn(listRef.current);
    setVariationsState(listRef.current);
  }, []);

  const find = (id: string) => listRef.current.find((v) => v.id === id) ?? null;

  /** Sends `goal` and `steps` to a new background variation and records it in its own portfolio. */
  const toBackground = useCallback((goal: string, steps: WorkflowStep[], reason: string): Variation => {
    const v = createVariation(goal, steps, reason);
    change((list) => addVariation(list, v));
    depsRef.current.record(variationActor(v.id), 'work', variationRecord(v), variationSource(v));
    depsRef.current.log(`Background variation "${v.goal}" started (${reason}) — ${v.steps.length} step(s) keep running`, 'info');
    return v;
  }, [change]);

  /** The goal was superseded: the previous goal and steps keep running in the background. */
  const supersede = useCallback((previousGoal: string, steps: WorkflowStep[], nextGoal: string) => {
    if (!previousGoal.trim() || !steps.length) return null;
    return toBackground(previousGoal, steps, `superseded by "${nextGoal.trim()}"`);
  }, [toBackground]);

  /** Starts a new variation: the current goal and steps go to the background and the main project is cleared. */
  const startVariation = () => {
    const { goal, steps } = depsRef.current.main();
    if (!goal.trim() && !steps.length) {
      depsRef.current.log('Nothing to branch — type a goal or plan steps first', 'warn');
      return;
    }
    toBackground(goal || 'Untitled variation', steps, 'new variation started');
    depsRef.current.setMain('', []);
  };

  /** Focuses `id`: it becomes the main project (its records join the main operation) and the current main keeps running in the background. */
  const switchTo = (id: string) => {
    const v = find(id);
    if (!v) return;
    const { goal, steps } = depsRef.current.main();
    budgetsRef.current.delete(id);
    change((list) => removeVariation(list, id));
    depsRef.current.mergeRecords(id, { operation: v.goal, opId: null });
    if (goal.trim() && steps.length) toBackground(goal, steps, `focus switched to "${v.goal}"`);
    depsRef.current.setMain(v.goal, v.steps);
    depsRef.current.log(`Focus switched to variation "${v.goal}"`, 'ok');
  };

  /** Merges `id`'s results into the main project: its new steps are appended and its records join the main operation. */
  const merge = (id: string) => {
    const v = find(id);
    if (!v) return;
    const { goal, steps } = depsRef.current.main();
    const merged = mergeSteps(steps, v.steps);
    depsRef.current.setMain(goal || v.goal, merged);
    depsRef.current.mergeRecords(id, { operation: (goal || v.goal).trim(), opId: null });
    budgetsRef.current.delete(id);
    change((list) => removeVariation(list, id));
    depsRef.current.log(`Merged variation "${v.goal}" into the main project — ${merged.length - steps.length} new step(s)`, 'ok');
  };

  /** Discards `id` and its portfolio records; sibling variations are untouched. */
  const discard = (id: string) => {
    const v = find(id);
    if (!v) return;
    budgetsRef.current.delete(id);
    change((list) => removeVariation(list, id));
    depsRef.current.forgetRecords(id);
    depsRef.current.log(`Discarded variation "${v.goal}"`, 'warn');
  };

  const pause = (id: string) => change((list) => updateVariation(list, id, (v) => pauseVariation(v, 'Paused by user')));

  /** Resumes `id` with a fresh action budget; failed steps are retried. */
  const resume = (id: string) => {
    budgetsRef.current.delete(id);
    change((list) => updateVariation(list, id, (v) => resumeVariation(v)));
  };

  /** The action budget of `id`, created on its first step. */
  const budgetOf = (id: string) => {
    let b = budgetsRef.current.get(id);
    if (!b) {
      b = createBudget(depsRef.current.budgetLimit());
      budgetsRef.current.set(id, b);
    }
    return b;
  };

  /** Records a finished step in the variation's own portfolio, plus its method once every step is done. */
  const recordStep = (before: Variation, step: WorkflowStep, out: VariationStepOutcome) => {
    const { record, log } = depsRef.current;
    const actor = variationActor(before.id);
    record(actor, 'result', `"${step.name}": ${out.message}`, variationSource(before), out.ok);
    const after = find(before.id);
    if (after?.status === 'done') {
      record(actor, 'method', learnedMethod(after), variationSource(after));
      log(`Background variation "${after.goal}" finished every step`, 'ok');
    }
    if (after?.status === 'paused') log(`Background variation "${after.goal}" paused — ${after.reason}`, 'warn');
  };

  /** One background round: unless a guardrail holds it, the next running variation runs one step. */
  const tick = async () => {
    if (busyRef.current) return;
    const reason = depsRef.current.blocked();
    setHeld(reason);
    const v = reason ? null : nextRunnable(listRef.current);
    if (!v) return;
    const index = nextStepIndex(v);
    const step = v.steps[index];
    busyRef.current = true;
    try {
      const out = await depsRef.current.runStep(step, variationActor(v.id), budgetOf(v.id));
      change((list) => updateVariation(list, v.id, (x) => applyStepResult(x, index, out.ok, out.message)));
      if (find(v.id)) recordStep(v, step, out);
    } finally {
      busyRef.current = false;
    }
  };
  const tickRef = useRef(tick);
  tickRef.current = tick;

  // Background loop while any variation is running.
  const anyRunning = variations.some((v) => v.status === 'running');
  useEffect(() => {
    if (!anyRunning) return undefined;
    const id = setInterval(() => void tickRef.current(), VARIATION_TICK_MS);
    return () => clearInterval(id);
  }, [anyRunning]);

  return { variations, held, supersede, startVariation, switchTo, merge, discard, pause, resume, tick };
}

export type VariationsApi = ReturnType<typeof useVariations>;
