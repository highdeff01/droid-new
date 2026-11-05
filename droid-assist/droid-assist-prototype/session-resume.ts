import type { ResumePayload } from './main-bridge-protocol.js';

/**
 * Session resume: when either app restarts mid-operation the other holds the run's state and, on
 * reconnect, resumes it — replaying what happened while the restarted app was down. The snapshot is
 * plain data, so it survives a reload and travels over the bridge unchanged.
 */

/** Most replay lines held for a run; enough to reconstruct what was missed. */
export const REPLAY_LIMIT = 200;

/** The state of a run as the other app holds it while one side is down. */
export interface RunSnapshot {
  runId: string;
  goal: string;
  /** The planned steps, in order. */
  steps: string[];
  /** 0-based index to resume from. */
  activeIndex: number;
  /** What happened, oldest first (capped at REPLAY_LIMIT). */
  replay: string[];
  /** When the snapshot was last updated. */
  at: number;
}

/** A fresh snapshot of a run that has just started. */
export const newSnapshot = (runId: string, goal: string, steps: readonly string[], at = Date.now()): RunSnapshot =>
  ({ runId, goal, steps: [...steps], activeIndex: 0, replay: [], at });

/** The snapshot advanced to `activeIndex` with one more replay line appended (capped). */
export function advanceSnapshot(snap: RunSnapshot, activeIndex: number, line: string, at = Date.now()): RunSnapshot {
  return { ...snap, activeIndex, replay: [...snap.replay, line].slice(-REPLAY_LIMIT), at };
}

/** The wire payload of a snapshot. */
export const toResumePayload = (s: RunSnapshot): ResumePayload => ({ runId: s.runId, goal: s.goal, steps: s.steps, activeIndex: s.activeIndex, replay: s.replay });

/** The snapshot of a validated wire payload, stamped with when it arrived. */
export const fromResumePayload = (p: ResumePayload, at = Date.now()): RunSnapshot =>
  ({ runId: p.runId, goal: p.goal, steps: [...p.steps], activeIndex: p.activeIndex, replay: [...p.replay], at });

/**
 * How to resume from a snapshot: the step to resume at (clamped into the plan), the lines to replay
 * (only those the restarted app had not seen, given its own `seenCount`), and a summary line.
 */
export function resumePlan(snap: RunSnapshot, seenCount = 0): { resumeAt: number; replay: string[]; summary: string } {
  const resumeAt = Math.min(Math.max(0, snap.activeIndex), Math.max(0, snap.steps.length - 1));
  const replay = snap.replay.slice(seenCount);
  const step = snap.steps[resumeAt] ?? '(no steps)';
  const summary = `Resume run "${snap.goal}" at step ${resumeAt + 1} "${step}" — ${replay.length} line(s) happened while disconnected`;
  return { resumeAt, replay, summary };
}

/** Whether a snapshot is worth resuming: it has steps and has not run to the end. */
export const isResumable = (snap: RunSnapshot | null): snap is RunSnapshot => !!snap && snap.steps.length > 0 && snap.activeIndex < snap.steps.length;

/** One line for the log. */
export const resumeLine = (s: RunSnapshot) => `Run "${s.goal}" snapshot: ${s.activeIndex}/${s.steps.length} step(s), ${s.replay.length} replay line(s)`;
