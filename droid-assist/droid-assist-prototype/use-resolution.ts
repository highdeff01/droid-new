import { useLayoutEffect, useRef, useState } from 'react';
import type { Frame, LearnedPattern, LogEntry, WorkflowStep } from './types.js';
import type { AskFn } from './ai.js';
import type { ActionBudget } from './safety.js';
import type { HabitOutcome } from './habits.js';
import { sameElement, type BusAgentId, type BusMessage, type ForwardedElement } from './agent-bus.js';
import { newPattern } from './flow-memory.js';
import { uid } from './planner.js';
import { detectDisagreements, openDisagreements, reporterName, resolveDisagreement, settleByTests, toResolution, winningReport, type Disagreement, type Report, type Resolution, type ResolutionVia, type Ruling } from './resolution-center.js';
import { RECOVERY_OPS, appRecoverSteps, decide, enqueue, hardTrack, maintenanceSteps, reconnectWithBackoff, rechatSteps, scaffoldApp, splitArg, type Approval, type OpResult, type RecoveryOpKind, type ScaffoldFile } from './recovery-ops.js';

/** Log source of every resolution and recovery line. */
export const RESOLUTION_SOURCE = 'Resolution center';
/** Resolutions and recovery results kept for the panel. */
export const RESOLUTION_LIMIT = 30;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What the resolution center needs from the engine; every real-input step goes through `perform`. */
export interface ResolutionDeps {
  steps: WorkflowStep[];
  bus: BusMessage[];
  /** App/window context habits are recorded under. */
  context: () => string;
  goal: () => string;
  addLog: (from: string, message: string, tone?: LogEntry['tone']) => void;
  ask: AskFn;
  aiOnline: () => boolean;
  frame: () => Frame | null;
  currentSteps: () => WorkflowStep[];
  setPlan: (steps: WorkflowStep[]) => void;
  /** A fresh real-input budget for one operation. */
  newBudget: () => ActionBudget;
  /** Records the proposal and runs the step through the gated pipeline (abort, arm, executor, budget). */
  perform: (step: WorkflowStep, actor: string, why: string, budget: ActionBudget) => Promise<OpResult>;
  /** Whether the named element is really at the point on the live screen (off-screen points never are). */
  confirm: (name: string, point: { x: number; y: number }) => Promise<boolean>;
  /** One re-location of a named element on the live screen. */
  locate: (name: string) => Promise<{ x: number; y: number } | null>;
  forwardElement: (from: BusAgentId, element: ForwardedElement) => void;
  addPatterns: (patterns: LearnedPattern[]) => void;
  recordHabit: (outcome: HabitOutcome) => void;
  retry: () => Promise<OpResult>;
  selfTest: () => Promise<OpResult>;
  fix: () => Promise<OpResult>;
  connect: () => Promise<boolean>;
}

/** A recovery operation's logged outcome. */
export interface OpRecord extends OpResult {
  id: string;
  time: number;
  op: RecoveryOpKind;
  arg: string;
}

/** A scaffolded app ready to download. */
export interface ScaffoldRecord {
  id: string;
  name: string;
  files: ScaffoldFile[];
}

const cap = <T,>(list: T[]) => list.slice(0, RESOLUTION_LIMIT);

/**
 * The AI resolution center: detects judgment differences between the main plan and the agents'
 * bus reports, settles each by a model ruling or by tests, applies the winning edit and feeds the
 * outcome to patterns, habits and the known elements; runs the recovery operations, with admin
 * operations queued behind approvals.
 */
export function useResolution(deps: ResolutionDeps) {
  const depsRef = useRef(deps);
  useLayoutEffect(() => {
    depsRef.current = deps;
  });
  const [resolutions, setResolutions] = useState<Resolution[]>([]);
  const resolutionsRef = useRef<Resolution[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const approvalsRef = useRef<Approval[]>([]);
  const [ops, setOps] = useState<OpRecord[]>([]);
  const [scaffolds, setScaffolds] = useState<ScaffoldRecord[]>([]);
  const [resolving, setResolving] = useState(false);

  const disagreements = openDisagreements(detectDisagreements(deps.steps, deps.bus), resolutions);

  /** Runs steps in order through the gated pipeline on one budget; stops at the first failure. */
  const runSteps = async (steps: WorkflowStep[], why: string): Promise<OpResult> => {
    const d = depsRef.current;
    const budget = d.newBudget();
    const done: string[] = [];
    for (const step of steps) {
      const out = await d.perform(step, RESOLUTION_SOURCE, why, budget);
      if (!out.ok) return { ok: false, message: `"${step.name}" failed — ${out.message}` };
      done.push(out.message);
    }
    return { ok: true, message: done.join('; ') };
  };

  /** Tests one report: the element must be confirmed at its point on the live screen. */
  const testReport = (d: Disagreement) => async (r: Report) => {
    const ok = await depsRef.current.confirm(d.element, { x: r.element.x, y: r.element.y });
    depsRef.current.addLog(RESOLUTION_SOURCE, `Test of "${d.element}" at ${reporterName(r.reporter)}'s position: ${ok ? 'PASS' : 'FAIL'}`, ok ? 'ok' : 'warn');
    return ok;
  };

  /** The winning position replaces the plan's position of the element. */
  const applyEdit = (d: Disagreement, winner: Report) => {
    if (winner.reporter === 'main') return;
    const { currentSteps, setPlan } = depsRef.current;
    const moved = { x: winner.element.x, y: winner.element.y, correctedX: undefined, correctedY: undefined, status: 'pending' as const };
    setPlan(currentSteps().map((s) => (s.target && sameElement(s.target, d.element) ? { ...s, ...moved } : s)));
  };

  /** Logs the resolution and feeds it to the plan, the known elements, patterns and habits. */
  const record = (d: Disagreement, via: ResolutionVia, winner: Report | null, ruling: Ruling | null) => {
    const deps2 = depsRef.current;
    if (winner) {
      applyEdit(d, winner);
      deps2.forwardElement('supervisor', winner.element);
    }
    const res = toResolution(d, via, winner, ruling);
    resolutionsRef.current = cap([res, ...resolutionsRef.current]);
    setResolutions(resolutionsRef.current);
    deps2.addLog(RESOLUTION_SOURCE, `${via === 'unresolved' ? 'Unresolved' : `Resolved by ${via === 'ai' ? 'AI ruling' : 'test'}`}: ${res.brief}`, winner ? 'ok' : 'warn');
    deps2.addPatterns([newPattern(winner ? 'add' : 'avoid', winner ? res.brief : `trusting a disputed position of "${d.element}"`, deps2.goal())]);
    deps2.recordHabit({ target: d.element, context: deps2.context(), success: !!winner, add: winner ? res.brief : null });
    return res;
  };

  /** The model's ruling, or null when the AI is offline or failed (then tests settle it). */
  const ruling = async (d: Disagreement): Promise<Ruling | null> => {
    const { aiOnline, ask, frame, addLog } = depsRef.current;
    if (!aiOnline()) return null;
    try {
      return await resolveDisagreement(ask, d, frame());
    } catch (error) {
      addLog(RESOLUTION_SOURCE, `No AI ruling on "${d.element}" — ${errorText(error)}; settling by tests`, 'warn');
      return null;
    }
  };

  /** Settles one disagreement: the AI ruling when it is sure, tests otherwise. */
  const resolveOne = async (d: Disagreement): Promise<Resolution> => {
    const r = await ruling(d);
    const ruled = r && !r.needsTest ? winningReport(d, r) : null;
    if (ruled) return record(d, 'ai', ruled, r);
    const tested = await settleByTests(d, testReport(d));
    return record(d, tested ? 'test' : 'unresolved', tested, r);
  };

  /** Settles every open disagreement, one at a time. */
  const resolveAll = async () => {
    if (resolving) return;
    setResolving(true);
    try {
      const open = openDisagreements(detectDisagreements(depsRef.current.steps, depsRef.current.bus), resolutionsRef.current);
      if (!open.length) depsRef.current.addLog(RESOLUTION_SOURCE, 'No disagreements between the main AI and the agents', 'info');
      for (const d of open) await resolveOne(d);
    } finally {
      setResolving(false);
    }
  };

  /** Element recovery (once) or hard tracking (persistent): the found point is forwarded to the agents. */
  const recoverElement = async (name: string, persistent: boolean): Promise<OpResult> => {
    const { locate, forwardElement } = depsRef.current;
    const { point, attempts } = persistent ? await hardTrack(() => locate(name), sleep) : { point: await locate(name), attempts: 1 };
    if (!point) return { ok: false, message: `"${name}" not found after ${attempts} attempt(s)` };
    forwardElement('supervisor', { name, x: point.x, y: point.y });
    return { ok: true, message: `"${name}" re-acquired at (${(point.x * 100).toFixed(1)}%, ${(point.y * 100).toFixed(1)}%) after ${attempts} attempt(s)` };
  };

  /** App creation: scaffolds within the sandboxed script rules; a rule break refuses it. */
  const createApp = (arg: string): OpResult => {
    const { head, rest } = splitArg(arg);
    const scaffold = scaffoldApp(head, rest);
    if (!scaffold.ok) return { ok: false, message: `Refused by the sandboxed script rules: ${scaffold.violations.join(', ')}` };
    setScaffolds((list) => cap([{ id: uid('app'), name: head || 'app', files: scaffold.files }, ...list]));
    return { ok: true, message: `Scaffolded ${scaffold.files.map((f) => f.path).join(', ')}` };
  };

  const reconnect = async (): Promise<OpResult> => {
    const r = await reconnectWithBackoff(depsRef.current.connect, sleep);
    return { ok: r.ok, message: r.ok ? `Bridge reconnected after ${r.attempts} attempt(s)` : `Bridge still down after ${r.attempts} attempt(s)` };
  };

  const maintenance = (arg: string): Promise<OpResult> => {
    const steps = maintenanceSteps(arg);
    return steps ? runSteps(steps, `the approved "${arg}" maintenance routine runs via computer control`) : Promise.resolve({ ok: false, message: `Unknown maintenance routine "${arg}" — use repair, backup or cleanup` });
  };

  const rechat = (arg: string): Promise<OpResult> => {
    const { head, rest } = splitArg(arg);
    if (!head || !rest) return Promise.resolve({ ok: false, message: 'Re-chat needs "Program: message"' });
    return runSteps(rechatSteps(head, rest), `rerouting the question to ${head} for a second opinion`);
  };

  const appRecover = (arg: string): Promise<OpResult> =>
    arg.trim() ? runSteps(appRecoverSteps(arg.trim()), `"${arg.trim()}" needs recovering, so it is relaunched or refocused`) : Promise.resolve({ ok: false, message: 'App recovery needs an app name' });

  /** Each operation's runner. */
  const RUNNERS: Record<RecoveryOpKind, (arg: string) => Promise<OpResult> | OpResult> = {
    retry: () => depsRef.current.retry(),
    fix: () => depsRef.current.fix(),
    appRecover,
    test: () => depsRef.current.selfTest(),
    elementRecover: (arg) => recoverElement(arg.trim(), false),
    hardTrack: (arg) => recoverElement(arg.trim(), true),
    createApp,
    maintenance,
    rechat,
    reconnect,
  };

  /** Runs an operation and logs it and feeds it to patterns and habits. */
  const execute = async (op: RecoveryOpKind, arg: string): Promise<OpResult> => {
    const out = await Promise.resolve(RUNNERS[op](arg)).catch((error: unknown) => ({ ok: false, message: errorText(error) }));
    const d = depsRef.current;
    const label = `${RECOVERY_OPS[op].label}${arg.trim() ? ` "${arg.trim()}"` : ''}`;
    setOps((list) => cap([{ id: uid('op'), time: Date.now(), op, arg, ...out }, ...list]));
    d.addLog(RESOLUTION_SOURCE, `${label}: ${out.message}`, out.ok ? 'ok' : 'error');
    d.addPatterns([newPattern(out.ok ? 'add' : 'avoid', `${label} — ${out.message}`, d.goal())]);
    d.recordHabit({ target: RECOVERY_OPS[op].label, context: d.context(), success: out.ok });
    return out;
  };

  const setQueue = (next: Approval[]) => {
    approvalsRef.current = next;
    setApprovals(next);
  };

  /** Runs an operation; an admin-class one only queues for approval. */
  const runOp = async (op: RecoveryOpKind, arg = ''): Promise<OpResult> => {
    if (!RECOVERY_OPS[op].admin) return execute(op, arg);
    setQueue(enqueue(approvalsRef.current, op, arg));
    const message = `${RECOVERY_OPS[op].label} "${arg}" queued — waiting for approval`;
    depsRef.current.addLog(RESOLUTION_SOURCE, message, 'warn');
    return { ok: false, message };
  };

  /** Approves (runs) or rejects a queued admin operation. */
  const decideApproval = async (id: string, approve: boolean): Promise<OpResult | null> => {
    const { queue, item } = decide(approvalsRef.current, id, approve);
    if (!item) return null;
    setQueue(queue);
    if (approve) return execute(item.op, item.arg);
    depsRef.current.addLog(RESOLUTION_SOURCE, `${RECOVERY_OPS[item.op].label} "${item.arg}" rejected — not run`, 'info');
    return null;
  };

  return {
    disagreements, resolutions, resolving, resolveAll, approvals, ops, scaffolds, runOp,
    approve: (id: string) => decideApproval(id, true),
    reject: (id: string) => decideApproval(id, false),
  };
}
