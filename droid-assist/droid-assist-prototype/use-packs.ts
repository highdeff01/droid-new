import { useEffect, useRef, useState } from 'react';
import type { Frame, LogEntry, WorkflowStep } from './types.js';
import type { AskFn } from './ai.js';
import { createBudget, type ActionBudget } from './safety.js';
import { runSubagents, type SubagentOutcome, type SubagentResult, type SubagentTask } from './subagents.js';
import type { RunOutcome } from './triggers.js';
import { loadPacks, savePacks } from './storage.js';
import {
  PACK_MOVE_LIMIT, addMove, appendTestResult, combinePacks, crossRunSelection, generateGoal, isFull, moveStep, newPack, packTestResult, packTestTasks, runGoalFor, runnable,
  similarGoal, similarReport, stepLine, withGoal, type PackSelection, type SimilarReport, type StepRun, type WorkflowPack,
} from './packs.js';

/** How often the pack tester runs while idle. */
export const PACK_TEST_INTERVAL_MS = 60_000;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const EMPTY: PackSelection = { packIds: [], stepIds: [] };
const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/** What the packs need from the assistant engine. */
export interface PackDeps {
  addLog: (from: string, message: string, tone?: LogEntry['tone']) => void;
  /** The main goal input, used as a new pack's goal text when none is typed. */
  goalInput: () => string;
  ask: () => AskFn;
  frame: () => Frame | null;
  /** The AI plans steps for `goal` on the live frame with `context`; never reuses a saved flow. */
  plan: (goal: string, context: string[]) => Promise<WorkflowStep[]>;
  /** One step through the grounded pipeline (proposal, briefing, live grounding, dispatch or dry run). */
  runStep: (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean) => Promise<StepRun>;
  /** Runs `steps` as the workflow through the replay pipeline. */
  replay: (steps: WorkflowStep[], label: string, goal: string) => Promise<RunOutcome | null>;
  setRecording: (on: boolean) => void;
  armed: () => boolean;
  /** The executor is in use or ABORTED is active: no background test may start. */
  busy: () => boolean;
  /** Stop or the emergency abort was pressed. */
  stopped: () => boolean;
  /** Clears a previous Stop before a new pack run (ABORTED stays until cleared). */
  resetStop: () => void;
  budget: () => number;
}

/**
 * Workflow packs: recording up to PACK_MOVE_LIMIT moves into a pack, goal bars, combining,
 * moving steps, running packs alone, combined or as a cross-run selection, AI perform-similar
 * with a complete/incomplete report, and background tests logged per pack. Persisted.
 */
export function usePacks(deps: PackDeps, recording: boolean) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const [packs, setPacks] = useState<WorkflowPack[]>([]);
  const packsRef = useRef<WorkflowPack[]>([]);
  const hydratedRef = useRef(false);
  const [recordingPackId, setRecordingPackId] = useState<string | null>(null);
  const recordingPackRef = useRef<string | null>(null);
  const [selection, setSelection] = useState<PackSelection>(EMPTY);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [running, setRunning] = useState<string | null>(null);
  const [report, setReport] = useState<SimilarReport | null>(null);
  const [background, setBackground] = useState(true);
  const testingRef = useRef(false);

  const commit = (next: WorkflowPack[]) => {
    packsRef.current = next;
    setPacks(next);
  };
  const patch = (id: string, fn: (p: WorkflowPack) => WorkflowPack) => commit(packsRef.current.map((p) => (p.id === id ? fn(p) : p)));
  const find = (id: string) => packsRef.current.find((p) => p.id === id);
  const log = (message: string, tone: LogEntry['tone'] = 'info') => depsRef.current.addLog('Packs', message, tone);
  const setActive = (id: string | null) => {
    recordingPackRef.current = id;
    setRecordingPackId(id);
  };

  useEffect(() => {
    let live = true;
    void loadPacks().then((stored) => {
      if (!live) return;
      hydratedRef.current = true;
      commit([...packsRef.current, ...stored.filter((s) => !packsRef.current.some((p) => p.id === s.id))]);
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (hydratedRef.current) savePacks(packs);
  }, [packs]);

  /** The AI writes a goal for a pack that has steps but no goal; the user can edit it in the goal bar. */
  const ensureGoal = async (id: string) => {
    const pack = find(id);
    if (!pack || pack.goal || !pack.steps.length) return;
    try {
      const goal = await generateGoal(depsRef.current.ask(), pack.steps, depsRef.current.frame());
      patch(id, (p) => (p.goal ? p : withGoal(p, goal, 'ai')));
      log(`"${pack.name}": AI goal — ${goal}`, 'ok');
    } catch (error) {
      log(`"${pack.name}": AI could not generate a goal (${errorText(error)}) — type one in its goal bar`, 'warn');
    }
  };

  const createPack = (name: string, input = '') => {
    const pack = newPack(name || `Pack ${packsRef.current.length + 1}`, input.trim() || depsRef.current.goalInput());
    commit([...packsRef.current, pack]);
    log(`Created "${pack.name}"${pack.goal ? ` — goal: ${pack.goal}` : ''}`);
    return pack;
  };

  const deletePack = (id: string) => {
    if (recordingPackRef.current === id) depsRef.current.setRecording(false);
    commit(packsRef.current.filter((p) => p.id !== id));
    setSelection((s) => ({ packIds: s.packIds.filter((x) => x !== id), stepIds: s.stepIds }));
  };

  const setGoal = (id: string, goal: string) => patch(id, (p) => withGoal(p, goal, 'user'));

  /** Records the next moves into pack `id` (stopping at its cap), or stops recording it. */
  const toggleRecord = (id: string) => {
    if (recordingPackRef.current === id) return depsRef.current.setRecording(false);
    const pack = find(id);
    if (!pack || isFull(pack)) return log(`"${pack?.name ?? id}" already holds ${PACK_MOVE_LIMIT} moves — move or delete a step first`, 'warn');
    setActive(id);
    depsRef.current.setRecording(true);
    log(`Recording into "${pack.name}" — up to ${PACK_MOVE_LIMIT - pack.steps.length} more move(s)`);
  };

  /** A recorded step: added to the pack being recorded; recording stops when the pack is full. */
  const capture = (step: WorkflowStep) => {
    const pack = recordingPackRef.current ? find(recordingPackRef.current) : undefined;
    if (!pack) return;
    const r = addMove(pack, step);
    if (!r.added) return log(`Not added to "${pack.name}": ${r.reason}`, 'warn');
    patch(pack.id, () => r.pack);
    log(`"${pack.name}": captured ${step.action} ${r.pack.steps.length}/${PACK_MOVE_LIMIT}`);
    if (isFull(r.pack)) depsRef.current.setRecording(false);
  };

  // Recording ended (stopped by the user or by the cap): close the pack and fill in a missing goal.
  useEffect(() => {
    if (recording || !recordingPackId) return;
    const pack = find(recordingPackId);
    setActive(null);
    if (!pack) return;
    log(`Stopped recording "${pack.name}" — ${pack.steps.length}/${PACK_MOVE_LIMIT} move(s)`, 'ok');
    void ensureGoal(pack.id);
  }, [recording, recordingPackId]);

  const selectPack = (id: string) => setSelection((s) => ({ ...s, packIds: toggle(s.packIds, id) }));
  const selectStep = (id: string) => setSelection((s) => ({ ...s, stepIds: toggle(s.stepIds, id) }));
  const clearSelection = () => setSelection(EMPTY);

  /** Combines the selected packs into one new workflow. */
  const combine = () => {
    const made = combinePacks(packsRef.current, selectionRef.current.packIds);
    if ('error' in made) return log(made.error, 'warn');
    commit([...packsRef.current, made]);
    log(`Combined into "${made.name}" — ${made.steps.length} step(s)`, 'ok');
    void ensureGoal(made.id);
  };

  const move = (stepId: string, toPackId: string) => {
    const moved = moveStep(packsRef.current, stepId, toPackId);
    if ('error' in moved) return log(moved.error, 'warn');
    commit(moved.packs);
  };

  /** Runs `steps` through the replay pipeline under the label `what`; with no goal, one derived from the label and steps. */
  const runSteps = async (what: string, steps: WorkflowStep[], goal: string) => {
    if (!steps.length) return log(`${what}: nothing to run — record or select steps first`, 'warn');
    setRunning(what);
    try {
      await depsRef.current.replay(steps, what, goal || runGoalFor(what, steps));
    } finally {
      setRunning(null);
    }
  };

  /** Runs one pack (recorded or combined) on its own. */
  const runPack = (id: string) => {
    const pack = find(id);
    if (pack) return runSteps(`Pack "${pack.name}"`, crossRunSelection([pack], { packIds: [id], stepIds: [] }), pack.goal);
  };

  /** Runs just the selected steps and whole packs, in pack order. */
  const crossRun = () => runSteps('Cross-run', crossRunSelection(packsRef.current, selectionRef.current), '');

  /** Plans the selected steps' action anew on the live screen and runs it step by step; null when there is no plan. */
  const planAndRun = async (picked: WorkflowStep[], dryRun: boolean): Promise<SimilarReport> => {
    const d = depsRef.current;
    let plan: WorkflowStep[];
    try {
      plan = await d.plan(similarGoal(picked), picked.map((s) => `[Example step] ${stepLine(s)}`));
    } catch (error) {
      return similarReport([], [], dryRun, errorText(error));
    }
    const budget = createBudget(d.budget());
    d.resetStop();
    const runs: StepRun[] = [];
    for (const step of plan) {
      if (d.stopped()) break;
      const out = await d.runStep(step, 'Perform similar', budget, dryRun);
      runs.push(out);
      if (!out.ok) break;
    }
    return similarReport(plan, runs, dryRun);
  };

  /** "Perform similar action" on the selected steps: grounded on the live screen, reported complete or exactly where incomplete. */
  const performSimilar = async () => {
    const picked = crossRunSelection(packsRef.current, selectionRef.current);
    const d = depsRef.current;
    const refused = !picked.length ? 'select recorded steps first' : d.busy() ? 'a run is in progress or ABORTED is active' : null;
    setRunning('Perform similar');
    try {
      const r = refused ? similarReport([], [], true, refused) : await planAndRun(picked, !d.armed());
      setReport(r);
      d.addLog('Perform similar', r.message, r.complete ? 'ok' : 'error');
    } finally {
      setRunning(null);
    }
  };

  /** One background test: the pack's steps through the grounded pipeline under its budget slice. */
  const testPack = async (task: SubagentTask, dryRun: boolean): Promise<SubagentOutcome> => {
    const d = depsRef.current;
    const steps = find(task.id)?.steps ?? [];
    const outcome = (status: SubagentOutcome['status'], message: string): SubagentOutcome => ({ status, message, dry: dryRun, shots: [], thinking: [] });
    const budget = createBudget(task.budget);
    for (const [i, step] of steps.entries()) {
      if (d.stopped()) return outcome('aborted', `Stopped before step ${i + 1} "${step.name}" — nothing more sent`);
      const out = await d.runStep(runnable(step), 'Pack tester', budget, dryRun);
      if (!out.ok) return outcome('fail', `Step ${i + 1} "${step.name}": ${out.message}`);
    }
    return outcome('pass', `${steps.length} step(s) ${dryRun ? 'verified on the live screen (dry run)' : 'executed'}`);
  };

  /** Logs a finished pack test into its pack's test log and the activity log. */
  const recordTest = (results: SubagentResult[]) => {
    const r = results[results.length - 1];
    if (!r) return;
    patch(r.id, (p) => appendTestResult(p, packTestResult(r)));
    depsRef.current.addLog('Pack tester', `"${r.label}": ${r.status.toUpperCase()}${r.dry ? ' (dry run)' : ''} — ${r.message}`, r.status === 'pass' ? 'ok' : r.status === 'fail' ? 'error' : 'warn');
  };

  /** One round of background tests over every pack with steps (dry run unless armed); skipped while busy. */
  const testPacks = async () => {
    const d = depsRef.current;
    const tasks = packTestTasks(packsRef.current, d.budget());
    if (!tasks.length || testingRef.current || running || recordingPackRef.current || d.busy()) return;
    testingRef.current = true;
    d.resetStop();
    const dryRun = !d.armed();
    try {
      await runSubagents(tasks, (t) => testPack(t, dryRun), d.stopped, recordTest);
    } finally {
      testingRef.current = false;
    }
  };
  const testRef = useRef(testPacks);
  testRef.current = testPacks;

  useEffect(() => {
    if (!background) return undefined;
    const id = setInterval(() => void testRef.current(), PACK_TEST_INTERVAL_MS);
    return () => clearInterval(id);
  }, [background]);

  return {
    packs, recordingPackId, selection, running, report, background, setBackground,
    createPack, deletePack, setGoal, toggleRecord, capture, selectPack, selectStep, clearSelection,
    combine, move, runPack, crossRun, performSimilar, testPacks,
  };
}

/** The packs surface the engine exposes to the panel. */
export type PacksEngine = ReturnType<typeof usePacks>;
