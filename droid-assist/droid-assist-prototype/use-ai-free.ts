import { useRef, useState } from 'react';
import type { Frame, LogEntry, WorkflowStep } from './types.js';
import type { AskFn } from './ai.js';
import type { SendFn } from './run-step.js';
import type { InboundMessage, OutboundPayloads, OutboundType, ResultPayload } from './main-bridge-protocol.js';
import type { SavedOperation } from './saved-operations.js';
import { downloadText } from './action-history.js';
import { decodeFrame } from './frame-codec.js';
import { describeAttempt } from './retry-ladder.js';
import { runAiFree, type AiFreeDeps, type AiFreeOutcome } from './ai-free.js';
import { recordingTemplate, sampleOperations, type SceneRenderer } from './sample-workflows.js';
import { TRACE_EXTENSION, exportTrace, importTrace, newTrace, recordStep, replayTrace, type Trace } from './trace.js';
import { createTakeover, type Takeover } from './takeover.js';
import { buildWorkflow } from './workflow-builder.js';

/** Where an AI-free run's frames come from and where its input goes, for the current source; null when there is no source. */
export interface AiFreeRoute {
  capture: () => Promise<Frame>;
  send: SendFn;
}

/** What the AI-free features need from the engine. */
export interface AiFreeHookDeps {
  addLog: (from: string, message: string, tone?: LogEntry['tone']) => void;
  /** The current source's frames and real-input path. */
  route: () => AiFreeRoute | null;
  /** Learned last-known-good coordinates of a step's target on `live`. */
  learned: (live: Frame, step: WorkflowStep) => { x: number; y: number } | null;
  /** Strengthens the learned coordinates after a verified dispatch. */
  onVerified: (live: Frame, step: WorkflowStep, p: { x: number; y: number }) => void;
  /** The AI's re-plan of a step that failed verification (null when offline or it has none). */
  replan: (step: WorkflowStep, why: string) => Promise<WorkflowStep | null>;
  /** The AI for workflow building; null while it is unavailable. */
  ask: () => AskFn | null;
  /** Renders a demo scene as a frame, for the sample workflows' reference screenshots. */
  renderScene: SceneRenderer;
  /** Saves one operation (same name = replaced). */
  saveOperation: (op: SavedOperation) => void;
  loadSteps: (name: string, steps: WorkflowStep[]) => void;
  steps: () => WorkflowStep[];
  goal: () => string;
  /** The latest captured frames, newest first (screenshots for the AI and the handoff). */
  frames: () => Frame[];
  retries: () => number;
  stopped: () => string | null;
  busy: () => boolean;
  /** Sends one command to droid-main over the main-app bridge. */
  sendMain: <K extends OutboundType>(type: K, payload: OutboundPayloads[K]) => Promise<ResultPayload>;
  mainConnected: () => boolean;
  /** Tells droid-new's AI (its thinking timeline) what happened. */
  tellAi: (note: string) => void;
}

const SOURCE = 'AI-free';
const TAKEOVER = 'Takeover';
/** The droid-new agents that watch every step and vote on it. */
const NEW_AGENTS = ['Verifier', 'Drift monitor'];
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The trace's frames of step `i` as screenshots, oldest first. */
const traceShots = (trace: Trace, i: number) => {
  const t = trace.steps[i];
  return t ? [t.beforeFrame.url, ...(t.afterFrame ? [t.afterFrame.url] : [])] : [];
};

/**
 * AI-free execution, sample workflows, trace record/export/import/replay, the droid-main takeover
 * controller and AI-assisted workflow building, on the engine's real-input path.
 */
export function useAiFree(deps: AiFreeHookDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const [trace, setTrace] = useState<Trace | null>(null);
  const [running, setRunning] = useState(false);
  const traceRef = useRef<Trace | null>(null);
  const triedRef = useRef<string[][]>([]);
  const log = (message: string, tone: LogEntry['tone'] = 'info') => depsRef.current.addLog(SOURCE, message, tone);

  const commitTrace = (next: Trace | null) => {
    traceRef.current = next;
    setTrace(next);
  };

  const takeoverRef = useRef<Takeover | null>(null);
  takeoverRef.current ??= createTakeover({
    send: (type, payload) => depsRef.current.sendMain(type, payload),
    connected: () => depsRef.current.mainConnected(),
    context: (i) => ({
      screenshots: traceRef.current?.steps[i] ? traceShots(traceRef.current, i) : depsRef.current.frames().slice(0, 2).reverse().map((f) => f.url),
      tried: triedRef.current[i] ?? [],
    }),
    tellAi: (note) => depsRef.current.tellAi(note),
    log: (message, tone) => depsRef.current.addLog(TAKEOVER, message, tone),
  });
  const takeover = takeoverRef.current;

  /** Starts a run (or refuses one); returns the route to run on, or null. */
  const begin = (what: string): AiFreeRoute | null => {
    if (depsRef.current.busy() || running) {
      log(`${what} not started — a run is in progress`, 'warn');
      return null;
    }
    const route = depsRef.current.route();
    if (!route) log(`${what} not started — no capture source`, 'warn');
    return route;
  };

  /** The AI-free pipeline's host on `route`, with the AI consulted only after a failed verification. */
  const pipeline = (route: AiFreeRoute): Omit<AiFreeDeps, 'consultAi'> => ({
    capture: route.capture,
    send: route.send,
    learned: (live, step) => depsRef.current.learned(live, step),
    onVerified: (step, live, p) => depsRef.current.onVerified(live, step, p),
    settleMs: 300,
    log: (m, tone) => log(m, tone),
  });

  /** Reports one executed step: droid-new's verification and its agents' vote. */
  const reportStep = (i: number, out: AiFreeOutcome) => {
    takeover.stepVerified(i, out.ok, out.message);
    takeover.newAgentsVote(i, out.ok, NEW_AGENTS, out.ok ? 'screen verified the step' : `step not verified: ${out.message}`);
  };

  /** Runs `steps` AI-free, one step at a time, tracing every action and reporting it to the takeover controller. */
  const runSteps = async (route: AiFreeRoute, goal: string, steps: WorkflowStep[]) => {
    const host: AiFreeDeps = { ...pipeline(route), consultAi: (step, why) => depsRef.current.replan(step, why) };
    let recorded = newTrace(goal);
    let aiCalls = 0;
    triedRef.current = [];
    commitTrace(recorded);
    takeover.startRun(goal, steps);
    for (const [i, step] of steps.entries()) {
      const run = await runAiFree([step], host);
      const out = run.results[0];
      aiCalls += run.aiCalls;
      triedRef.current[i] = [`${out.source} point (${out.target.x.toFixed(3)}, ${out.target.y.toFixed(3)}): ${out.message}`];
      recorded = recordStep(recorded, step, out);
      commitTrace(recorded);
      reportStep(i, out);
      if (!out.ok) await takeover.handoff(i, `droid-new could not verify the step: ${out.message}`);
    }
    takeover.stop();
    const ok = recorded.steps.filter((s) => s.verdict === 'verified').length;
    log(`AI-free run of "${goal}": ${ok}/${steps.length} step(s) verified, ${aiCalls} AI call(s)`, ok === steps.length ? 'ok' : 'warn');
  };

  /** Runs `steps` (default: the current workflow) AI-free. */
  const runAiFreeSteps = async (steps = depsRef.current.steps(), goal = depsRef.current.goal()) => {
    if (!steps.length) return log('Nothing to run — record, load or build some steps first', 'warn');
    const route = begin('AI-free run');
    if (!route) return;
    setRunning(true);
    try {
      await runSteps(route, goal || 'AI-free run', steps);
    } finally {
      setRunning(false);
    }
  };

  /** Installs the shipped sample workflows as saved operations, with their reference screenshots. */
  const installSamples = () => {
    const ops = sampleOperations(depsRef.current.renderScene);
    for (const op of ops) depsRef.current.saveOperation(op);
    log(`Installed ${ops.length} sample workflow(s): ${ops.map((o) => o.name).join(', ')}`, 'ok');
  };

  /** Loads a saved operation's steps as a fresh recording template. */
  const loadAsTemplate = (op: SavedOperation) => {
    const stamp = Date.now().toString(36);
    depsRef.current.loadSteps(`${op.name} (template)`, recordingTemplate(op, (i) => `tpl-${stamp}-${i}`));
    log(`Loaded "${op.name}" as a recording template (${op.steps.length} step(s))`, 'ok');
  };

  /** Downloads the current trace as a file. */
  const exportTraceFile = () => {
    const t = traceRef.current;
    if (!t?.steps.length) return log('No trace to export — run some steps AI-free first', 'warn');
    downloadText(`droid-trace-${new Date(t.startedAt).toISOString().replace(/[:.]/g, '-')}${TRACE_EXTENSION}`, exportTrace(t), 'application/json');
    log(`Exported the trace of "${t.goal}" (${t.steps.length} step(s))`, 'ok');
  };

  /** Imports a trace file; a file with a missing before-frame is rejected. */
  const importTraceFile = async (text: string) => {
    try {
      const t = await importTrace(text, decodeFrame);
      commitTrace(t);
      log(`Imported the trace of "${t.goal}" (${t.steps.length} step(s))`, 'ok');
    } catch (error) {
      log(`Trace not imported — ${errorText(error)}`, 'error');
    }
  };

  /** Replays the current trace with real dispatches, per-step verification, drift correction and the retry ladder. */
  const replayCurrentTrace = async () => {
    const t = traceRef.current;
    if (!t?.steps.length) return log('No trace to replay — run or import one first', 'warn');
    const route = begin('Trace replay');
    if (!route) return;
    setRunning(true);
    try {
      const retries = depsRef.current.retries();
      const result = await replayTrace(t, {
        ...pipeline(route),
        retries,
        stopped: () => depsRef.current.stopped(),
        replan: (step, why) => depsRef.current.replan(step, why),
        onAttempt: (step, a) => log(`"${step.name}": ${describeAttempt(a, retries)}`, a.ok ? 'ok' : 'warn'),
      });
      const ok = result.steps.filter((s) => s.out.ok).length;
      log(`Replayed "${t.goal}": ${ok}/${t.steps.length} step(s) verified`, result.ok ? 'ok' : 'warn');
    } finally {
      setRunning(false);
    }
  };

  /** Builds a workflow from `command` with the AI (10 screenshots per batch), performing each step AI-free once verified. */
  const buildFromCommand = async (command: string) => {
    if (!command.trim()) return log('Type a command to build a workflow from', 'warn');
    const route = begin('Workflow building');
    if (!route) return;
    setRunning(true);
    try {
      const host: AiFreeDeps = pipeline(route);
      const result = await buildWorkflow(command, [...depsRef.current.frames()].reverse(), {
        ask: depsRef.current.ask(),
        perform: async (step) => (await runAiFree([step], host)).ok,
        log: (m, tone) => log(m, tone),
      });
      if (result.skipped) return log(result.skipped, 'warn');
      depsRef.current.loadSteps(command, result.steps);
      log(`Built "${command}": ${result.steps.length} step(s), ${result.verified.length} verified, ${result.performed.length} performed (${result.batches.length} screenshot batch(es))`, 'ok');
    } finally {
      setRunning(false);
    }
  };

  return {
    aiFreeTrace: trace,
    aiFreeRunning: running,
    runAiFreeSteps,
    installSamples,
    loadAsTemplate,
    exportTraceFile,
    importTraceFile,
    replayCurrentTrace,
    buildFromCommand,
    /** Droid-main's takeover messages; true when handled. */
    onTakeoverMessage: (m: InboundMessage) => takeover.onInbound(m),
  };
}
