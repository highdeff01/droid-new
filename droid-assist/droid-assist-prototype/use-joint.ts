/**
 * The joint "working together" engine over the main app bridge: it holds droid-main's status,
 * diagnoses errors of either app into a corrective change, sends approved code fixes to droid-main,
 * and runs joint operations — droid-new arbitrates which app calculates and which performs, every
 * half is recorded with its app, and the result is followed up against each app's fresh state until
 * the goal-completion check confirms nothing is left.
 */
import { useRef, useState } from 'react';
import type { GoalCheck } from './assist-ai.js';
import type { ApprovalDraft, ApprovalItem } from './approvals.js';
import { ARBITER, decisionText, selectApps, type AppDecision, type AppProfile, type JointOperation } from './app-selection.js';
import type { CheckResult } from './follow-up.js';
import type { FixContext } from './fix-script.js';
import { DIAGNOSED_KINDS, codeFixPayload, diagnose, type JointError } from './joint-errors.js';
import { continueJoint, isStale, verifyJoint, type AppSnapshot, type JointAction, type JointTurn } from './joint-followup.js';
import { appTally, jointDraft, recallLines } from './joint-memory.js';
import type { MainBridge } from './main-bridge.js';
import type { JointApp, JointRole, ResultPayload, StatusPayload } from './main-bridge-protocol.js';
import type { OperationRecord } from './operation-db.js';
import type { OperationDraft } from './operation-log.js';
import { createProject, type Project } from './project.js';
import type { Frame, LogEntry } from './types.js';

/** The capability a joint operation needs from the app that acts on a screen. */
export const JOINT_CAPABILITY = 'act';
/** What droid-new can always take on. */
export const LOCAL_CAPABILITIES: readonly string[] = [JOINT_CAPABILITY];
/** droid-main's assumed round trip before one was measured. */
export const MAIN_LATENCY_MS = 250;
/** How long a follow-up waits for a fresh droid-main frame before judging the last one (stale). */
export const FRAME_WAIT_MS = 5000;
/** The same error of the same app is diagnosed at most once in this window. */
export const DIAGNOSE_WINDOW_MS = 60_000;
/** Diagnosed error keys kept before the window is reset. */
const DIAGNOSED_LIMIT = 200;
/** Log source of every joint line. */
export const JOINT_SOURCE = 'Joint';

/** What the engine needs from the assist engine; read on every use, so it may change between renders. */
export interface JointDeps {
  addLog: (from: string, message: string, tone?: LogEntry['tone']) => void;
  bridge: () => MainBridge | null;
  /** Queues a request in the approval queue. */
  queue: (draft: ApprovalDraft) => ApprovalItem;
  /** Proposes a bounded fix script in droid-new. */
  fixScript: (ctx: FixContext) => void;
  /** Records an operation in the operation database. */
  record: (draft: OperationDraft) => void;
  /** Every stored operation, newest first. */
  history: () => Promise<OperationRecord[]>;
  /** The app whose screen is on the stage. */
  target: () => JointApp;
  /** droid-new's executor is busy. */
  busy: () => boolean;
  /** droid-new does its half of an operation. */
  local: (role: JointRole, text: string) => Promise<ResultPayload>;
  /** droid-new's live frame. */
  localFrame: () => Frame | null;
  /** Recent log lines of one app, newest first. */
  lines: (app: JointApp) => string[];
  /** Judges an action against its app's frame with the cross-reference as context. */
  verify: (action: JointAction, frame: Frame | null, context: string[]) => Promise<CheckResult>;
  /** Commands of the goal still waiting for approval. */
  pending: (goal: string) => number;
  /** A guardrail reason to stop; null = go on. */
  halt: () => string | null;
  now?: () => number;
}

interface JointState {
  status: StatusPayload | null;
  latencyMs: number;
  frame: Frame | null;
  waiters: Set<(f: Frame) => void>;
  diagnosed: Map<string, number>;
}

type Snapshotter = (app: JointApp, since: number) => Promise<AppSnapshot>;
type Verifier = (action: JointAction, snap: AppSnapshot, context: string[]) => Promise<CheckResult>;

/** The joint engine; `get` returns the current deps. */
export function createJointEngine(get: () => JointDeps) {
  const s: JointState = { status: null, latencyMs: MAIN_LATENCY_MS, frame: null, waiters: new Set(), diagnosed: new Map() };
  const now = () => (get().now ?? Date.now)();
  const log = (message: string, tone: LogEntry['tone'] = 'info') => get().addLog(JOINT_SOURCE, message, tone);

  /** Both apps as app selection weighs them now. */
  const profiles = (): AppProfile[] => {
    const d = get();
    return [
      { app: 'droid-new', connected: true, capabilities: LOCAL_CAPABILITIES, load: d.busy() ? 1 : 0, aiCalls: 1, latencyMs: 0 },
      { app: 'droid-main', connected: d.bridge()?.state().status === 'connected', capabilities: s.status?.capabilities ?? [], load: s.status?.load ?? 1, aiCalls: 1, latencyMs: s.latencyMs },
    ];
  };

  /** droid-main's status: kept for app selection, logged when its capabilities change. */
  const onStatus = (p: StatusPayload) => {
    if (s.status?.capabilities.join() !== p.capabilities.join()) log(`droid-main status: capabilities ${p.capabilities.join(', ') || '(none)'} at load ${Math.round(p.load * 100)}%`);
    s.status = p;
  };

  /** A decoded droid-main frame: the latest one, handed to any follow-up waiting for it. */
  const onFrame = (f: Frame) => {
    s.frame = f;
    s.waiters.forEach((w) => w(f));
  };

  /** A droid-main frame taken at or after `since`, requested over the bridge; the last one when none arrives in time. */
  const mainFrameSince = (since: number) => new Promise<Frame | null>((resolve) => {
    const bridge = get().bridge();
    if ((s.frame && s.frame.time >= since) || bridge?.state().status !== 'connected') return resolve(s.frame);
    const finish = (f: Frame | null) => {
      clearTimeout(timer);
      s.waiters.delete(waiter);
      resolve(f);
    };
    const waiter = (f: Frame) => (f.time >= since ? finish(f) : undefined);
    const timer = setTimeout(() => finish(s.frame), FRAME_WAIT_MS);
    s.waiters.add(waiter);
    void bridge.send('request_frame', {});
  });

  /** One app's actual state: droid-main's from a fresh bridge frame, droid-new's live. */
  const snapshotter = (notes: string[]): Snapshotter => async (app, since) => {
    const frame = app === 'droid-main' ? await mainFrameSince(since) : get().localFrame();
    const time = app === 'droid-main' ? frame?.time ?? 0 : now();
    return { app, time, screenshot: frame?.url ?? null, log: get().lines(app), notes };
  };

  const verifier: Verifier = (action, snap, context) => get().verify(action, snap.app === 'droid-main' ? s.frame : get().localFrame(), context);

  /** An error of either app: diagnosed once per window into a fix script (droid-new) or a queued code fix (droid-main). */
  const onError = (e: JointError) => {
    if (!DIAGNOSED_KINDS.includes(e.kind)) return;
    const key = `${e.app}:${e.message}`;
    const t = now();
    if (t - (s.diagnosed.get(key) ?? -Infinity) < DIAGNOSE_WINDOW_MS) return;
    if (s.diagnosed.size >= DIAGNOSED_LIMIT) s.diagnosed.clear();
    s.diagnosed.set(key, t);
    const c = diagnose(e);
    log(`Diagnosed: ${c.reason}`, 'warn');
    if (c.kind === 'fix_script') get().fixScript(c.context);
    else get().queue(c.draft);
  };

  /** A decided approval: an approved joint code fix is sent to droid-main. */
  const onDecided = async (item: ApprovalItem) => {
    const payload = codeFixPayload(item);
    if (!payload) return;
    const sent = await get().bridge()?.send('code_fix', payload);
    if (sent?.ok) log(`Code fix for ${payload.file} sent to droid-main`, 'ok');
    else log(`Code fix for ${payload.file} not sent — ${sent?.message ?? 'main app not connected'}`, 'warn');
  };

  /** One half on its app: droid-new locally, droid-main as a joint_request over the bridge. */
  const half = async (app: JointApp, role: JointRole, operation: string, goal: string, reason: string): Promise<ResultPayload> => {
    if (app === ARBITER) return get().local(role, goal);
    const bridge = get().bridge();
    if (!bridge) return { ok: false, message: 'Main app not connected' };
    const started = now();
    const r = await bridge.request('joint_request', { operation, role, goal, reason });
    s.latencyMs = now() - started;
    return r;
  };

  /** Runs one half, records it with its app and logs the outcome. */
  const doHalf = async (d: AppDecision, role: JointRole, goal: string, reason: string) => {
    const app = role === 'calculate' ? d.calculate : d.perform;
    const r = await half(app, role, d.operation, goal, reason);
    get().record(jointDraft({ operation: d.operation, app, role, ok: r.ok, output: r.message }, d));
    log(`${role} on ${app}: ${r.ok ? 'done' : 'failed'} — ${r.message}`, r.ok ? 'ok' : 'warn');
    return r;
  };

  /** One joint turn: calculate, then perform with the result; earlier turns' actions are past. */
  const turnOf = (d: AppDecision) => {
    const past: JointAction[] = [];
    return async (p: Project, injected: string[]): Promise<JointTurn> => {
      const goal = [p.goal, ...injected].join(' — ');
      const calc = await doHalf(d, 'calculate', goal, d.reason);
      if (calc.ok) await doHalf(d, 'perform', goal, `${d.reason}; calculated: ${calc.message}`);
      const action: JointAction = { id: `${d.operation}#${p.turn}`, app: d.perform, label: d.operation, phase: 'current', expect: p.goal };
      const turn = { actions: [...past, action], endedAt: now() };
      past.push({ ...action, phase: 'past' });
      return turn;
    };
  };

  /** An alternative attempt of a failed action: performed again with why it failed. */
  const retryOf = (d: AppDecision) => async (action: JointAction, pass: number, reason: string) => {
    await doHalf(d, 'perform', `${action.expect} — retry ${pass} after: ${reason}`, `alternative attempt after: ${reason}`);
  };

  /** The goal-completion check on the target app's state after the turn ended (`since`); a stale frame never confirms it. */
  const checkOf = (target: JointApp, snap: Snapshotter, verify: Verifier, since: () => number) => async (p: Project): Promise<GoalCheck> => {
    const goal: JointAction = { id: 'goal', app: target, label: p.goal, phase: 'current', expect: p.goal };
    const shot = await snap(target, since());
    if (isStale(shot, since())) return { complete: false, progress: false, reason: `${target} state is stale — no frame newer than the operation`, thinking: null };
    const r = await verify(goal, shot, []);
    return { complete: r.ok, progress: r.ok, reason: r.reason, thinking: null };
  };

  /** A joint operation: placed by app selection, then run and followed up until complete. */
  const run = async (operation: string): Promise<void> => {
    const history = await get().history();
    const target = get().target();
    const op: JointOperation = { name: operation, capability: JOINT_CAPABILITY, target, crossApp: target !== ARBITER };
    const sel = selectApps(op, profiles(), appTally(history, operation));
    if (!sel.ok) return log(sel.reason, 'warn');
    log(decisionText(sel.decision));
    const snap = snapshotter(recallLines(history, operation));
    let endedAt = now();
    const result = await continueJoint(createProject(`Joint: ${operation}`, operation), {
      halt: () => get().halt(),
      turn: turnOf(sel.decision),
      followUp: (t) => {
        endedAt = t.endedAt;
        return verifyJoint(t.actions, t.endedAt, { snapshot: snap, verify: verifier, retry: retryOf(sel.decision), now });
      },
      check: checkOf(target, snap, verifier, () => endedAt),
      pending: (p) => get().pending(p.goal),
    });
    const { done, reason } = result.completion;
    log(`"${operation}" ${done ? 'complete' : 'not complete'} after ${result.turns} joint turn(s): ${reason}`, done ? 'ok' : 'warn');
  };

  return { onStatus, onFrame, onError, onDecided, run };
}

export type JointEngine = ReturnType<typeof createJointEngine>;

/** The joint engine of one assist engine, reading the latest deps on every use. */
export function useJoint(deps: JointDeps): JointEngine {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const [engine] = useState(() => createJointEngine(() => depsRef.current));
  return engine;
}
