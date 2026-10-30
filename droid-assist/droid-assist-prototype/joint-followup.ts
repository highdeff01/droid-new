/**
 * Joint follow-up and continuation: after a joint operation every action is verified against the
 * actual state of the app it ran in — droid-main's from a frame requested after the operation ended,
 * never a stale mirror — with alternative retries and a cross-reference of past, current and planned
 * actions built from BOTH apps' screenshots, logs and notes. Continuation turns loop until the
 * lifecycle engine's goal-completion check confirms nothing is left.
 */
import type { GoalCheck } from './assist-ai.js';
import { MAX_FOLLOW_UP_PASSES, followUpText, runFollowUp, type CheckResult, type FollowUpReport } from './follow-up.js';
import { JOINT_APPS, type JointApp } from './main-bridge-protocol.js';
import { PROJECT_TURN_LIMIT, completionCheck, consumeInjections, injectInfo, recordCheck, type Completion, type Project } from './project.js';

/** Log and note lines of each app given to the cross-reference. */
export const CROSS_REFERENCE_LINES = 5;

/** Where an action sits in the joint operation. */
export type ActionPhase = 'past' | 'current' | 'planned';

/** One action of a joint operation, on the app that performs it. */
export interface JointAction {
  id: string;
  app: JointApp;
  label: string;
  phase: ActionPhase;
  /** What the app's screen should show once it is done. */
  expect: string;
}

/** One app's actual state: its screenshot (taken at `time`), recent log lines and notes. */
export interface AppSnapshot {
  app: JointApp;
  time: number;
  screenshot: string | null;
  log: string[];
  notes: string[];
}

export interface JointFollowUpDeps {
  /** A fresh state of the app; for droid-main a frame requested over the bridge after `since`. */
  snapshot: (app: JointApp, since: number) => Promise<AppSnapshot>;
  /** Judges the action against its app's snapshot with the cross-reference as context. */
  verify: (action: JointAction, snap: AppSnapshot, context: string[]) => Promise<CheckResult>;
  /** An alternative attempt of a failed action before the next pass (`pass` ≥ 2). */
  retry: (action: JointAction, pass: number, reason: string) => Promise<void>;
  now: () => number;
}

/** A snapshot taken before `since` shows the screen before the operation ended. */
export const isStale = (snap: AppSnapshot, since: number) => snap.time < since;

/** The cross-reference: past, current and planned actions of both apps, then each app's latest log lines and notes. */
export function crossReference(actions: readonly JointAction[], snaps: readonly AppSnapshot[]): string[] {
  const acts = actions.map((a) => `[${a.phase} · ${a.app}] ${a.label} — expect: ${a.expect}`);
  const state = snaps.flatMap((s) => [
    `[${s.app} screen] ${s.screenshot ? `frame at ${new Date(s.time).toISOString()}` : 'no frame'}`,
    ...s.log.slice(0, CROSS_REFERENCE_LINES).map((l) => `[${s.app} log] ${l}`),
    ...s.notes.slice(0, CROSS_REFERENCE_LINES).map((n) => `[${s.app} note] ${n}`),
  ]);
  return [...acts, ...state];
}

/**
 * Verifies the current actions of a joint operation that ended at `endedAt`: each against a fresh
 * snapshot of its own app (a stale one fails the check), cross-referenced with both apps; failed
 * actions get an alternative retry before each further pass.
 */
export async function verifyJoint(actions: readonly JointAction[], endedAt: number, deps: JointFollowUpDeps, maxPasses = MAX_FOLLOW_UP_PASSES): Promise<FollowUpReport> {
  const reasons = new Map<string, string>();
  const check = async (action: JointAction, pass: number): Promise<CheckResult> => {
    if (pass > 1) await deps.retry(action, pass, reasons.get(action.id) ?? '');
    const since = pass > 1 ? deps.now() : endedAt;
    const snaps = await Promise.all(JOINT_APPS.map((app) => deps.snapshot(app, since)));
    const own = snaps.find((s) => s.app === action.app)!;
    const r = isStale(own, since)
      ? { ok: false, reason: `${action.app} state is stale (frame ${since - own.time}ms older than the operation)` }
      : await deps.verify(action, own, crossReference(actions, snaps));
    reasons.set(action.id, r.reason);
    return r;
  };
  return runFollowUp(actions.filter((a) => a.phase === 'current'), (a) => `${a.app}: ${a.label}`, check, maxPasses);
}

/** One joint turn: the actions it ran and when it ended. */
export interface JointTurn {
  actions: JointAction[];
  endedAt: number;
}

export interface ContinuationDeps {
  /** A guardrail reason to stop; null = go on. */
  halt: () => string | null;
  /** Runs the next joint operation for the project with the info injected since the last turn. */
  turn: (p: Project, injected: string[]) => Promise<JointTurn>;
  followUp: (turn: JointTurn) => Promise<FollowUpReport>;
  check: (p: Project) => Promise<GoalCheck>;
  /** Commands of the project still waiting for approval (code fixes included). */
  pending: (p: Project) => number;
  maxTurns?: number;
}

export interface ContinuationResult {
  project: Project;
  completion: Completion;
  turns: number;
}

/** Nothing left: the follow-up verified every action and the lifecycle completion check passes. */
function settle(p: Project, report: FollowUpReport, check: GoalCheck, pending: number): Completion {
  if (!report.done) return { done: false, reason: followUpText(p.name, report) };
  return completionCheck(p, check, pending);
}

/**
 * Loops joint turns until the completion check confirms nothing is left, a guardrail halts or the
 * turn cap is hit; an unfinished turn's follow-up and goal check are injected into the next one.
 */
export async function continueJoint(project: Project, deps: ContinuationDeps): Promise<ContinuationResult> {
  const max = deps.maxTurns ?? PROJECT_TURN_LIMIT;
  let p = project;
  for (let turns = 0; turns < max; turns += 1) {
    const stop = deps.halt();
    if (stop) return { project: p, completion: { done: false, reason: stop }, turns };
    const { project: fed, injected } = consumeInjections(p);
    const report = await deps.followUp(await deps.turn(fed, injected.map((i) => i.text)));
    const check = await deps.check(fed);
    p = recordCheck({ ...fed, turn: fed.turn + 1 }, check);
    const completion = settle(p, report, check, deps.pending(p));
    if (completion.done) return { project: p, completion, turns: turns + 1 };
    p = injectInfo(p, { source: 'main-ai', from: 'joint follow-up', text: completion.reason });
  }
  return { project: p, completion: { done: false, reason: `${max} joint turns without completing` }, turns: max };
}
