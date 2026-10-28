import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadText } from './action-history.js';
import { OPERATION_LIMIT, clearOperations as clearStore, loadOperations as loadOperationRecords, putOperation, type OperationRecord } from './operation-db.js';
import { buildOperation, type OperationDraft, type OperationScope } from './operation-log.js';
import { RELATED_LIMIT, exportOperations as exportEnvelope, relatedLines, type OperationQuery } from './operation-query.js';
import type { AssistSettings, Frame, Habit, LogEntry, WorkflowStep } from './types.js';
import type { RunOutcome } from './triggers.js';
import type { RunSummary } from './run-stats.js';
import { loadOperations, saveOperations } from './storage.js';
import { countRun, createOperation, notifySuggestion, referenceShots, suggestOperations, suggestionText, upsertOperation, type OperationSource, type SavedOperation } from './saved-operations.js';
import { DEFAULT_SCREEN, fetchPlayback, type Playback } from './playback.js';
import { bestVariant, detectRecent, verifyRetry, type DetectedOperation } from './operation-retry.js';

/** Records loaded from the store merged under the ones written before the load finished, newest first. */
function mergeLoaded(current: OperationRecord[], stored: OperationRecord[]): OperationRecord[] {
  const ids = new Set(current.map((r) => r.id));
  return [...current, ...stored.filter((r) => !ids.has(r.id))].sort((a, b) => b.time - a.time).slice(0, OPERATION_LIMIT);
}

/**
 * The operation database in the engine: every recorded operation is kept in memory (newest
 * first, pruned to OPERATION_LIMIT) and written to IndexedDB in the background.
 */
export function useOperationDatabase() {
  const [operations, setOperations] = useState<OperationRecord[]>([]);
  const ref = useRef(operations);
  const publish = (next: OperationRecord[]) => {
    ref.current = next;
    setOperations(next);
  };

  useEffect(() => {
    let live = true;
    void loadOperationRecords().then((stored) => live && publish(mergeLoaded(ref.current, stored)));
    return () => {
      live = false;
    };
  }, []);

  /** Records one operation in memory and in the store. */
  const record = useCallback((scope: OperationScope, draft: OperationDraft) => {
    const rec = buildOperation(scope, draft);
    publish([rec, ...ref.current].slice(0, OPERATION_LIMIT));
    void putOperation(rec);
  }, []);

  /** Prompt lines of the prior operations relevant to any of `texts` (an idea, a step target, the goal), deduplicated. */
  const related = useCallback((...texts: string[]) => [...new Set(texts.flatMap((t) => relatedLines(t, ref.current)))].slice(0, RELATED_LIMIT), []);

  /** Downloads the records matching `q` as a JSON export. */
  const exportOperations = useCallback((q: OperationQuery = {}) => {
    const out = exportEnvelope(ref.current, q);
    downloadText(`droid-operations-${out.exportedAt.replace(/[:.]/g, '-')}.json`, JSON.stringify(out, null, 2), 'application/json');
    return out.records.length;
  }, []);

  /** Deletes every operation from memory and the store. */
  const clearOperations = useCallback(() => {
    publish([]);
    void clearStore();
  }, []);

  return { operations, record, related, exportOperations, clearOperations };
}

/** What the operations features need from the engine. */
export interface OperationDeps {
  addLog: (from: string, message: string, tone?: LogEntry['tone']) => void;
  settings: () => AssistSettings;
  liveFrame: () => Frame | null;
  /** The current (last run's) steps. */
  steps: () => WorkflowStep[];
  /** Makes `steps` the current workflow, attributed to flow `flowId`. */
  loadSteps: (name: string, steps: WorkflowStep[], flowId: string | null) => void;
  /** Plans `goal` with the AI into the current steps; whether a plan was made. */
  plan: (goal: string) => Promise<boolean>;
  /** The full replay pipeline (ground → execute → verify); dry run unless real input is armed. */
  replay: (label: string, goal: string) => Promise<RunOutcome | null>;
  busy: () => boolean;
  habits: () => Habit[];
  habitContext: () => string;
  runs: RunSummary[];
}

const SOURCE = 'Operations';
const fullyExecuted = (o: RunOutcome) => !o.dryRun && !o.stopped && o.ok === o.total;

/** Saved operations, AI playback of the last 30 seconds, and detection + retry of recent operations. */
export function useOperations(deps: OperationDeps) {
  const [operations, setOperations] = useState<SavedOperation[]>([]);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [detected, setDetected] = useState<DetectedOperation[]>([]);
  const [suggested, setSuggested] = useState<SavedOperation[]>([]);
  const opsRef = useRef<SavedOperation[]>([]);
  const hydratedRef = useRef(false);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const log = (message: string, tone: LogEntry['tone'] = 'info') => depsRef.current.addLog(SOURCE, message, tone);

  const commit = useCallback((next: SavedOperation[]) => {
    opsRef.current = next;
    setOperations(next);
  }, []);

  useEffect(() => {
    let live = true;
    void loadOperations().then((stored) => {
      if (!live) return;
      hydratedRef.current = true;
      commit([...opsRef.current, ...stored.filter((s) => !opsRef.current.some((o) => o.id === s.id))]);
    });
    return () => {
      live = false;
    };
  }, [commit]);
  useEffect(() => {
    if (hydratedRef.current) saveOperations(operations);
  }, [operations]);

  /** The AI's suggestion: saved operations matching `text`, logged and shown as a notification. */
  const suggestFor = (text: string) => {
    const found = suggestOperations(text, opsRef.current);
    setSuggested(found);
    if (!found.length) return;
    const line = `Saved operation(s) that fit "${text.trim()}": ${found.map(suggestionText).join('; ')}`;
    depsRef.current.addLog('Suggestions', line, 'info');
    notifySuggestion(line);
  };

  /** Finds the saved operations just performed (recent run summaries, or `steps` performed) and logs them. */
  const detect = (steps: WorkflowStep[]) => {
    const found = detectRecent(opsRef.current, depsRef.current.runs, steps);
    setDetected(found);
    if (found.length) log(`Detected recent operation(s): ${found.map((f) => `"${f.op.name}" (${f.via === 'run' ? 'from a run summary' : 'from the performed steps'})`).join(', ')}`);
  };

  // After every run: detect the saved operations just performed and suggest matching ones.
  const latest = deps.runs[0]?.id;
  useEffect(() => {
    const d = depsRef.current;
    if (!latest) return;
    detect(d.steps());
    if (d.runs[0].goal) suggestFor(d.runs[0].goal);
  }, [latest]);

  /** Saves the current steps as a named operation (same name = replaced, keeping its counters). */
  const saveOperation = (name: string, goal: string, source: OperationSource = 'recorded', steps = depsRef.current.steps()) => {
    if (!name.trim()) return log('Name the operation first', 'warn');
    if (!steps.length) return log(`"${name.trim()}" not saved — record, plan or play back some steps first`, 'warn');
    const op = createOperation({ name, goal, steps, screenshots: referenceShots(steps, depsRef.current.liveFrame()), source });
    const { ops, replaced } = upsertOperation(opsRef.current, op);
    commit(ops);
    log(`Saved operation "${op.name}" (${op.steps.length} step(s), ${op.screenshots.length} screenshot(s))${replaced ? ' — replaced the one with the same name' : ''}`, 'ok');
  };

  /** Asks the AI to plan `request` ("go to chrome and open youtube") and saves the plan as an operation. */
  const planOperation = async (request: string, name = request) => {
    if (await depsRef.current.plan(request)) saveOperation(name, request, 'ai');
    else log(`"${name.trim() || request.trim()}" not saved — the AI made no plan`, 'warn');
  };

  const deleteOperation = (id: string) => commit(opsRef.current.filter((o) => o.id !== id));

  /** Makes the operation's steps the current workflow (for a run or a trigger). */
  const loadOperation = (op: SavedOperation) => depsRef.current.loadSteps(op.name, op.steps, op.id);

  /** Counts a finished run of operation `id`: a success only when every step executed as real input. */
  const countOutcome = (id: string, outcome: RunOutcome | null) => {
    if (outcome && !outcome.dryRun) commit(countRun(opsRef.current, id, fullyExecuted(outcome)));
  };

  /** Runs a saved operation through the replay pipeline; null when refused. */
  const runOperation = async (id: string, label?: string): Promise<RunOutcome | null> => {
    const op = opsRef.current.find((o) => o.id === id);
    if (!op) return null;
    if (depsRef.current.busy()) {
      log(`"${op.name}" not run — a run is in progress`, 'warn');
      return null;
    }
    loadOperation(op);
    const outcome = await depsRef.current.replay(label ?? `Operation "${op.name}"`, op.goal);
    countOutcome(op.id, outcome);
    return outcome;
  };

  /** Fetches the main app's actions of the last playbackWindowSec seconds with their screenshots through the bridge. */
  const loadPlayback = async () => {
    const { bridgeUrl, bridgeToken, playbackWindowSec } = depsRef.current.settings();
    const frame = depsRef.current.liveFrame();
    const res = await fetchPlayback(bridgeUrl, bridgeToken, frame ? { w: frame.srcW, h: frame.srcH } : DEFAULT_SCREEN, Date.now(), playbackWindowSec);
    if (!res.ok) return log(`Playback unavailable — ${res.message}`, 'warn');
    setPlayback(res.playback);
    setPlaybackIndex(0);
    log(`Playback: ${res.playback.entries.length} action(s) from the last ${playbackWindowSec} s of the main app`, res.playback.entries.length ? 'ok' : 'info');
    detect(res.playback.entries.map((e) => e.step));
  };

  /** Step-by-step visualization of the playback: moves to entry `i` (no input is sent). */
  const showPlaybackStep = (i: number) => {
    const n = playback?.entries.length ?? 0;
    if (n) setPlaybackIndex(Math.min(n - 1, Math.max(0, i)));
  };

  /** Re-runs the playback's actions through the replay pipeline: a dry run unless real input is armed. */
  const replayPlayback = async (): Promise<RunOutcome | null> => {
    if (!playback?.entries.length) {
      log('Nothing to replay — load a playback with actions first', 'warn');
      return null;
    }
    if (depsRef.current.busy()) {
      log('Playback not replayed — a run is in progress', 'warn');
      return null;
    }
    depsRef.current.loadSteps('Playback', playback.entries.map((e) => e.step), null);
    return depsRef.current.replay('Playback', `Repeat the actions of the last ${playback.windowSec} seconds`);
  };

  /** One retry of a variant: run it, then verify by comparing screenshots; logged. */
  const retryOnce = async (op: SavedOperation, n: number, of: number) => {
    const before = depsRef.current.liveFrame();
    const outcome = await runOperation(op.id, `Retry ${n}/${of} of "${op.name}"`);
    if (!outcome) return { done: true, verified: false };
    const check = verifyRetry(depsRef.current.liveFrame(), before, op.screenshots.at(-1) ?? null, outcome.ok === outcome.total);
    log(`Retry ${n}/${of} of "${op.name}" ${check.verified ? 'verified' : 'not verified'}: ${check.detail}${outcome.dryRun ? ' (dry run — no input sent)' : ''}`, check.verified ? 'ok' : 'warn');
    return { done: check.verified || outcome.stopped, verified: check.verified };
  };

  /** Retries the best-performing variant of a detected operation up to the set number of times, until one is verified. */
  const retryBest = async (id: string) => {
    const op = opsRef.current.find((o) => o.id === id);
    if (!op) return;
    const tries = depsRef.current.settings().operationRetries;
    if (tries <= 0) return log(`"${op.name}" not retried — retries of detected operations are set to 0`, 'info');
    const best = bestVariant(op, opsRef.current, depsRef.current.habits(), depsRef.current.habitContext());
    log(`Retrying "${best.op.name}" as the best variant of "${op.name}" (score ${best.score.toFixed(2)}: runs ${Math.round(best.runRate * 100)}%, habits ${Math.round(best.habitRate * 100)}%, ${best.anchors} remembered position(s)), up to ${tries} time(s)`);
    for (let n = 1; n <= tries; n++) {
      const r = await retryOnce(opsRef.current.find((o) => o.id === best.op.id) ?? best.op, n, tries);
      if (r.done) return;
    }
    log(`"${best.op.name}" was not verified after ${tries} retr${tries === 1 ? 'y' : 'ies'}`, 'warn');
  };

  return {
    operations, saveOperation, planOperation, deleteOperation, runOperation, loadOperation, countOutcome, suggestFor, suggested,
    playback, playbackIndex, loadPlayback, showPlaybackStep, replayPlayback, detected, retryBest,
  };
}
