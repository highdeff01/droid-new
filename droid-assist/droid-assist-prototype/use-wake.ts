import { useCallback, useEffect, useRef, useState } from 'react';
import type { AskFn } from './ai.js';
import type { Thought } from './assist-ai.js';
import type { StageId } from './loop-control.js';
import { detectChange } from './screen-change.js';
import type { ThoughtKind } from './thinking-timeline.js';
import type { AssistSettings, Frame, LogEntry, WorkflowStep } from './types.js';
import type { NoteKind } from './watcher.js';
import { createWakeSession, wakeDelay, wakeRequest, watchInterval, type WaitContext, type WakeEvent, type WakeSession } from './wake.js';
import { askDecision, decisionText, dispatchDecision, type DecisionHandlers, type ParallelSpec } from './wake-decision.js';
import { CONTEXT_LIMIT, CONTEXT_TICK_MS, contextText, contextTick, startContext, stopContext, stopReason, type ContextStop, type ContextWorkflow } from './context-workflow.js';

/** Screenshots kept from before a wait and sent with the fresh ones on wake. */
export const BEFORE_FRAMES = 3;

/** What wake-and-continue needs from the engine; read live on every use. */
export interface WakeDeps {
  settings: () => AssistSettings;
  /** Recent frames, newest first. */
  frames: () => Frame[];
  /** Recent log and note lines, newest first; with `since`, only those after it. */
  info: (since?: number) => string[];
  /** The newest error log entry after `since`, if any. */
  errorSince: (since: number) => LogEntry | undefined;
  /** A separate fresh screenshot (bridge desktop shot, else the latest monitor frame). */
  capture: () => Promise<Frame | null>;
  askFor: (stage: StageId) => AskFn;
  stageOn: (id: StageId) => boolean;
  thought: <T extends Thought>(step: string, call: () => Promise<T>, summary: (r: T) => string | null, kind?: ThoughtKind) => Promise<T>;
  addLog: (from: string, message: string, tone?: LogEntry['tone']) => void;
  takeNote: (kind: NoteKind, text: string, source: string) => void;
  /** What each wake decision does. */
  handlers: () => DecisionHandlers<Promise<void>>;
  /** Runs a context workflow's corrective move through the gated pipeline. */
  runMove: (step: WorkflowStep) => Promise<{ ok: boolean; message: string }>;
  /** The operation goal now: a change cancels the wait and ends context workflows started under another goal. */
  goal: string;
  aborted: boolean;
  isAborted: () => boolean;
}

const WAKE = 'Wake';
const BACKUP = 'Backup watcher';
const CONTEXT = 'Context workflow';

/**
 * Wake and continue: a backup-watched wait that wakes the AI (timer, or early on a notable change
 * or error) with the before and fresh screenshots so it decides how to continue, and the parallel
 * context workflows such a decision starts.
 */
export function useWake(deps: WakeDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const [wait, setWait] = useState<WaitContext | null>(null);
  const [contexts, setContexts] = useState<ContextWorkflow[]>([]);
  const sessionRef = useRef<WakeSession | null>(null);
  const contextsRef = useRef<ContextWorkflow[]>([]);
  const tickBusyRef = useRef(false);

  const putContexts = (next: ContextWorkflow[]) => {
    contextsRef.current = next.slice(0, CONTEXT_LIMIT);
    setContexts(contextsRef.current);
  };
  const patchContext = (wf: ContextWorkflow) => putContexts(contextsRef.current.map((c) => (c.id === wf.id ? wf : c)));

  /** Ends the wait without waking the AI. */
  const cancel = useCallback((why: string) => {
    if (!sessionRef.current || sessionRef.current.done) return;
    sessionRef.current.cancel();
    sessionRef.current = null;
    setWait(null);
    depsRef.current.addLog(WAKE, `Wait cancelled (${why}) — the AI was not woken`, 'warn');
  }, []);

  /** On wake: a separate fresh capture, then the AI decides from before + fresh; nothing acts before the decision. */
  const wake = async (ctx: WaitContext, e: WakeEvent) => {
    const d = depsRef.current;
    if (d.isAborted() || d.goal.trim() !== ctx.goal.trim()) return;
    const shot = await d.capture().catch(() => null);
    const fresh = [...(shot ? [shot] : []), ...d.frames().filter((f) => f.time > ctx.since && f.id !== shot?.id)].slice(0, BEFORE_FRAMES);
    const req = wakeRequest(ctx, { fresh, freshInfo: d.info(ctx.since) }, e);
    try {
      const decision = await d.thought(`Wake: ${ctx.step}`, () => askDecision(d.askFor('wake'), req), decisionText);
      const text = `Decision after waking on "${ctx.step}": ${decisionText(decision)}`;
      d.takeNote('decision', text, WAKE);
      d.addLog(WAKE, text, decision.kind === 'stop' ? 'warn' : 'info');
      if (!depsRef.current.isAborted()) await dispatchDecision(decision, d.handlers());
    } catch (error) {
      d.addLog(WAKE, `Wake decision failed — stopped, nothing executed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  /** The backup watcher's look: a new error log entry is an error; a material change from the pre-wait screen is a change. */
  const backupCheck = (base: Frame | undefined, since: number) => async (): Promise<string | null> => {
    const d = depsRef.current;
    const failed = d.errorSince(since);
    if (failed) throw new Error(`[${failed.source}] ${failed.message}`);
    const now = await d.capture();
    if (!base || !now || now.id === base.id) return null;
    const change = detectChange(base.data, now.data, d.settings().changeCells);
    return change ? `${change.cells} changed cells around (${Math.round((change.box.x + change.box.w / 2) * 100)}%, ${Math.round((change.box.y + change.box.h / 2) * 100)}%)` : null;
  };

  /**
   * Starts waiting before `step` on `waitingOn`: the user's wake timer, or the AI's longer estimate.
   * The backup watcher screenshots meanwhile and wakes the AI early. False when waking is off or a wait is already running.
   */
  const arm = useCallback((step: string, waitingOn: string, aiMs?: number): boolean => {
    const d = depsRef.current;
    if (!d.stageOn('wake') || (sessionRef.current && !sessionRef.current.done)) return false;
    const delay = wakeDelay(d.settings().wakeMs, aiMs);
    const before = d.frames().slice(0, BEFORE_FRAMES);
    const ctx: WaitContext = { goal: d.goal, step, waitingOn, since: Date.now(), delay, before, beforeInfo: d.info() };
    const interval = watchInterval(delay);
    sessionRef.current = createWakeSession({
      delay,
      interval,
      check: backupCheck(before[0], ctx.since),
      onWake: (e) => {
        sessionRef.current = null;
        setWait(null);
        const text = `Woke the AI (${e.cause}${e.detail ? `: ${e.detail}` : ''}) to continue "${step}" — it was waiting on: ${waitingOn}`;
        depsRef.current.takeNote('wake', text, e.cause === 'timer' ? WAKE : BACKUP);
        depsRef.current.addLog(e.cause === 'timer' ? WAKE : BACKUP, text, e.cause === 'error' ? 'warn' : 'info');
        void wake(ctx, e);
      },
    });
    setWait(ctx);
    const text = `Waiting before "${step}" on: ${waitingOn} — waking in ${Math.round(delay / 1000)} s${aiMs ? ' (AI estimate)' : ''}; backup watcher screenshots every ${(interval / 1000).toFixed(1)} s`;
    d.takeNote('wake', text, WAKE);
    d.addLog(WAKE, text, 'info');
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Starts a parallel context workflow from a decision, located on the latest frame. */
  const startParallel = useCallback((spec: ParallelSpec, by: string): boolean => {
    const d = depsRef.current;
    const frame = d.frames()[0];
    if (!d.stageOn('contextWorkflow') || !frame) {
      d.addLog(CONTEXT, `Parallel workflow "${spec.goal}" not started — ${frame ? 'the Parallel context workflows agent is off' : 'no captured frame'}`, 'warn');
      return false;
    }
    const wf = startContext(spec, frame, by, d.goal);
    putContexts([wf, ...contextsRef.current]);
    d.takeNote('decision', `Started parallel workflow: ${contextText(wf)}`, by);
    d.addLog(CONTEXT, `Started by ${by}: ${contextText(wf)}`, 'ok');
    return true;
  }, []);

  /** Ends a running context workflow for `why`. */
  const endContext = useCallback((id: string, why: ContextStop) => {
    const wf = contextsRef.current.find((c) => c.id === id && c.running);
    if (!wf) return;
    const ended = stopContext(wf, why);
    patchContext(ended);
    depsRef.current.takeNote('decision', `Parallel workflow ended (${why}): ${ended.goal}`, CONTEXT);
    depsRef.current.addLog(CONTEXT, `Ended (${why}): ${contextText(ended)}`, 'warn');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** One look of a running workflow: track, and only when too far ask the AI and run its move. */
  const tickOne = async (wf: ContextWorkflow, live: Frame) => {
    const d = depsRef.current;
    const { wf: tracked, move } = await contextTick(wf, live, d.askFor('contextWorkflow'));
    if (!move) return patchContext(tracked);
    d.takeNote('decision', `"${tracked.subject.name}" too far from "${tracked.anchor.name}" (${(tracked.distance * 100).toFixed(0)}%) — AI: ${move.why}`, CONTEXT);
    if (!move.step) return patchContext(tracked);
    const out = await d.runMove(move.step);
    patchContext({ ...tracked, moves: tracked.moves + (out.ok ? 1 : 0) });
    d.addLog(CONTEXT, `${move.step.name}: ${move.step.action} — ${out.message} (${move.why})`, out.ok ? 'ok' : 'error');
  };

  /** One round over the running workflows; a failed look is logged and the workflow keeps running. */
  const tickAll = async () => {
    const d = depsRef.current;
    const live = d.frames()[0];
    if (tickBusyRef.current || !live || !d.stageOn('contextWorkflow')) return;
    tickBusyRef.current = true;
    try {
      for (const wf of contextsRef.current.filter((c) => c.running && c.ref.id !== live.id)) {
        await tickOne(wf, live).catch((error) => d.addLog(CONTEXT, `Look failed for "${wf.goal}": ${error instanceof Error ? error.message : String(error)}`, 'error'));
      }
    } finally {
      tickBusyRef.current = false;
    }
  };
  const tickRef = useRef(tickAll);
  tickRef.current = tickAll;

  const anyRunning = contexts.some((c) => c.running);
  useEffect(() => {
    if (!anyRunning) return undefined;
    const id = setInterval(() => void tickRef.current(), CONTEXT_TICK_MS);
    return () => clearInterval(id);
  }, [anyRunning]);

  // An abort or a new operation goal cancels the wait and ends workflows started under another goal.
  const { goal, aborted } = deps;
  useEffect(() => {
    if (aborted) cancel('abort');
    else if (sessionRef.current && wait && wait.goal.trim() !== goal.trim()) cancel('the goal changed');
    for (const wf of contextsRef.current.filter((c) => c.running)) {
      const why = stopReason(wf, goal, aborted);
      if (why) endContext(wf.id, why);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal, aborted]);

  // Unmount: no timer or watcher outlives the engine.
  useEffect(() => () => sessionRef.current?.cancel(), []);

  return {
    wait, contexts, arm, cancel, startParallel, endContext,
    /** A wait is running: Auto Act does not act until the AI is woken and decides. */
    waiting: () => !!sessionRef.current && !sessionRef.current.done,
  };
}

/** Wake and continue's public surface, for the Wake panel. */
export type Wake = ReturnType<typeof useWake>;
