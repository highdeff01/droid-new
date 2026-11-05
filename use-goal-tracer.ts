import { useEffect, useState } from 'react';
import type { LogEntry } from './types.js';
import type { GoalCheck } from './assist-ai.js';
import { loadGoals, saveGoals } from './storage.js';
import { createGoal, goalBriefingLine, goalMemory, hydrateGoals, memoryLines, startGoal, trace, tracedCheck, tracerStatus, updateGoal, type GoalRecord, type TraceEvent } from './goal-tracer.js';

/** What a new goal record starts from. */
export type GoalInit = Parameters<typeof createGoal>[0];

/**
 * What the tracer reads live: whether it is on, the stall threshold, and where its notifications go.
 * Captured once, so each must read the engine's current state itself (through its refs).
 */
export interface GoalTracerDeps {
  enabled: () => boolean;
  stallLimit: () => number;
  notify: (message: string, tone: LogEntry['tone']) => void;
}

/** The tracer's operations over `initial` goals; every change of the list is handed to `publish`. */
export function createTracer(initial: GoalRecord[], deps: GoalTracerDeps, publish: (g: GoalRecord[]) => void) {
  let goals = initial;
  /** The goal of the operation in flight: the one begun last this session. */
  let currentId: string | null = null;
  const commit = (next: GoalRecord[]) => {
    goals = next;
    publish(next);
  };
  const current = () => goals.find((g) => g.id === currentId) ?? null;
  const active = () => {
    const g = current();
    return g?.status === 'active' && deps.enabled() ? g : null;
  };
  const begin = (init: GoalInit) => {
    if (!deps.enabled()) return;
    const record = createGoal(init);
    currentId = record.id;
    commit(startGoal(goals, record));
    deps.notify(`Tracing goal "${record.goal}" (${record.source}, ${record.stepIds.length} step(s))`, 'info');
  };
  const emit = (e: TraceEvent) => {
    const g = current();
    // Only the active goal is traced; a run end still links its run to a goal the run already finished.
    if (!g || !deps.enabled() || (g.status !== 'active' && e.kind !== 'run')) return;
    const { record, notices } = trace(g, e, { now: Date.now(), stallLimit: deps.stallLimit() });
    if (record !== g) commit(updateGoal(goals, g.id, () => record));
    notices.forEach((n) => deps.notify(n.text, n.tone));
  };
  return {
    begin,
    /** Starts a goal for a run that has none active. */
    ensure: (init: GoalInit) => {
      if (!active()) begin(init);
    },
    /** Ends the current operation's scope (a new plan): its goal, if still active, is paused and nothing more is traced into it. */
    release: () => {
      const g = active();
      currentId = null;
      if (g) commit(updateGoal(goals, g.id, (x) => ({ ...x, status: 'paused', updatedAt: Date.now() })));
    },
    emit,
    /** Traces a goal check and returns it as judged against the traced state (unchanged with nothing traced). */
    check: (c: GoalCheck): GoalCheck => {
      const g = active();
      if (!g) return c;
      const judged = tracedCheck(g, c);
      emit({ kind: 'check', complete: c.complete, progress: c.progress, reason: c.reason });
      return judged;
    },
    /** The active goal, while the tracer is on. */
    active,
    /** The pre-action briefing's progress line, or null with no traced goal. */
    briefingLine: () => {
      const g = active();
      return g ? goalBriefingLine(g) : null;
    },
    /** Planner context lines: recent, important and blacklisted finished goals related to `text`. */
    memory: (text: string) => memoryLines(goalMemory(goals, text)),
    status: () => tracerStatus(active(), deps.enabled()),
  };
}

/**
 * The live Goal tracer: every operation's GoalRecord (persisted, hydrated on startup with active goals paused),
 * traced from the events the engine emits, with notifications for steps, off-path runs, stalls and completion.
 */
export function useGoalTracer(deps: GoalTracerDeps) {
  const [goals, setGoals] = useState<GoalRecord[]>(() => hydrateGoals(loadGoals()));
  const [tracer] = useState(() => createTracer(goals, deps, setGoals));
  useEffect(() => saveGoals(goals), [goals]);
  return { goals, tracer };
}
