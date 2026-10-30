import type { Frame, LogEntry, StepAction, WorkflowStep } from './types.js';
import { DEFAULT_DRIFT, MATCHED, correctDrift, frameDistance, reverify, type DriftCorrection, type DriftThresholds, type Reverify } from './drift.js';
import type { SendFn, StepOutcome } from './run-step.js';

/**
 * AI-free execution: recorded steps, learned coordinates and saved workflows run with no model call —
 * the target is template-matched against the step's stored reference frame, drift-corrected or taken from
 * learned last-known-good coordinates, dispatched through the real-input path and verified on screen.
 * The AI is consulted only for a step whose verification failed.
 */

type Point = { x: number; y: number };

/** Where a step's dispatch point came from, in the order they are tried. */
export type LocateSource = 'template' | 'learned' | 'recorded';

/** A step's dispatch point on the live frame. */
export interface Located extends Point {
  source: LocateSource;
  /** The drift measurement of a template match (absent for learned / recorded points). */
  correction?: DriftCorrection;
}

/** What an AI-free run needs from its host; no member of it calls a model except `consultAi`. */
export interface AiFreeDeps {
  /** A fresh live frame of the screen the input lands on. */
  capture: () => Promise<Frame>;
  /** The real-input path (desktop bridge, main app or demo desktop). */
  send: SendFn;
  /** Learned last-known-good coordinates of the step's target found on `live` (habit anchor, access path, coordinate learner); null when none. */
  learned?: (live: Frame, step: WorkflowStep) => Point | null;
  /** The AI, asked once for a corrected step after verification failed; null when it has none. Absent means no AI. */
  consultAi?: (step: WorkflowStep, why: string, live: Frame | undefined) => Promise<WorkflowStep | null>;
  /** Called with every verified dispatch point, so the last-known-good coordinates follow the screen. */
  onVerified?: (step: WorkflowStep, live: Frame, p: Point) => void;
  /** The expected screen after a step (a reference after-frame), compared with the live after-frame when present. */
  expected?: (step: WorkflowStep) => Frame | undefined;
  /** Pause after the input before the after-frame is captured, in ms. */
  settleMs?: number;
  drift?: DriftThresholds;
  now?: () => number;
  log: (message: string, tone: LogEntry['tone']) => void;
}

/** One executed step with its full context: the ladder-compatible outcome plus planned point, locate source and timing. */
export interface AiFreeOutcome extends StepOutcome {
  /** The recorded (planned) point. */
  planned: Point;
  source: LocateSource;
  startedAt: number;
  ms: number;
}

/** The result of a whole AI-free run. */
export interface AiFreeRun {
  results: AiFreeOutcome[];
  /** Model calls made: one per step whose verification failed, zero while every step verifies. */
  aiCalls: number;
  ok: boolean;
}

/** Actions that send no input and change nothing on screen: verified by having run. */
const NO_EFFECT: ReadonlySet<StepAction> = new Set<StepAction>(['wait', 'measure', 'snip']);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The step's target on `live`: template match of its reference frame, else learned coordinates, else where it was recorded. */
export function locateAiFree(step: WorkflowStep, live: Frame, learned?: AiFreeDeps['learned'], drift: DriftThresholds = DEFAULT_DRIFT): Located {
  if (step.refFrame?.data) {
    const correction = correctDrift(step.refFrame.data, live.data, step.x, step.y, live.srcW, live.srcH, drift);
    if (correction.level !== 'red') return { x: correction.x, y: correction.y, source: 'template', correction };
  }
  const hit = learned?.(live, step);
  if (hit) return { ...hit, source: 'learned' };
  return { x: step.x, y: step.y, source: 'recorded' };
}

/** The step aimed at `at`: corrected start, and a drag's drop point shifted by the same offset. */
export function aimedStep(step: WorkflowStep, at: Point): WorkflowStep {
  const aimed = { ...step, correctedX: at.x, correctedY: at.y };
  if (typeof step.endX !== 'number' || typeof step.endY !== 'number') return aimed;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { ...aimed, endX: clamp(step.endX + at.x - step.x), endY: clamp(step.endY + at.y - step.y) };
}

/** Whether the after-frame shows the step took effect: the screen changed at the target and, when stored, it matches the expected frame. */
export function verifyAfter(step: WorkflowStep, check: Reverify, after: Frame, expected?: Frame): { ok: boolean; why: string } {
  if (NO_EFFECT.has(step.action)) return { ok: true, why: 'no visible effect expected' };
  if (!check.changed) return { ok: false, why: 'no visible change after input' };
  if (!expected?.data) return { ok: true, why: 'screen changed after input' };
  const d = frameDistance(after.data, expected.data);
  return { ok: d <= MATCHED, why: `screen changed; after-frame ${d <= MATCHED ? 'matches' : 'does not match'} the reference (distance ${d.toFixed(3)})` };
}

/** One step, AI-free: capture, locate, dispatch at the located point, capture again and verify. Never calls the AI. */
export async function executeStep(step: WorkflowStep, deps: AiFreeDeps): Promise<AiFreeOutcome> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const planned = { x: step.x, y: step.y };
  const done = (o: Omit<AiFreeOutcome, 'planned' | 'startedAt' | 'ms'>): AiFreeOutcome => ({ ...o, planned, startedAt, ms: now() - startedAt });
  let before: Frame;
  try {
    before = await deps.capture();
  } catch (error) {
    return done({ ok: false, executed: false, message: `no live frame: ${errorText(error)}`, target: planned, source: 'recorded', bridgeFailed: true });
  }
  const at = locateAiFree(step, before, deps.learned, deps.drift);
  const base = { target: { x: at.x, y: at.y }, source: at.source, correction: at.correction, live: before };
  const sent = await deps.send(aimedStep(step, at), before.srcW, before.srcH, { x: before.originX ?? 0, y: before.originY ?? 0 }).catch((error: unknown) => ({ ok: false, message: errorText(error) }));
  if (!sent.ok) return done({ ...base, ok: false, executed: false, message: `input not completed: ${sent.message}`, bridgeFailed: true });
  if (deps.settleMs) await sleep(deps.settleMs);
  const after = await deps.capture().catch(() => null);
  if (!after) return done({ ...base, ok: false, executed: true, message: 'input sent but no after-frame to verify it' });
  const check = reverify(before.data, after.data, at.x, at.y);
  const verdict = verifyAfter(step, check, after, deps.expected?.(step));
  if (verdict.ok) deps.onVerified?.(step, after, at);
  return done({ ...base, ok: verdict.ok, executed: true, shot: after, check, message: `${at.source} point — ${verdict.why}` });
}

/** The AI's one correction of a failed step, executed AI-free; an AI error or no answer leaves the step failed. */
async function consultOnce(step: WorkflowStep, failed: AiFreeOutcome, deps: AiFreeDeps): Promise<AiFreeOutcome> {
  try {
    const fixed = await deps.consultAi!(step, failed.message, failed.shot ?? failed.live);
    if (!fixed) return { ...failed, message: `${failed.message}; AI had no correction` };
    deps.log(`"${step.name}": AI corrected the step after failed verification — re-running it AI-free`, 'info');
    return await executeStep(fixed, deps);
  } catch (error) {
    deps.log(`"${step.name}": AI unavailable (${errorText(error)}) — step stays failed, run continues`, 'warn');
    return { ...failed, message: `${failed.message}; AI unavailable: ${errorText(error)}` };
  }
}

/** Runs every step AI-free in order; the AI is consulted once for each step that failed verification, and the run always continues. */
export async function runAiFree(steps: WorkflowStep[], deps: AiFreeDeps): Promise<AiFreeRun> {
  const results: AiFreeOutcome[] = [];
  let aiCalls = 0;
  for (const step of steps) {
    let out = await executeStep(step, deps);
    if (!out.ok && deps.consultAi) {
      aiCalls++;
      out = await consultOnce(step, out, deps);
    }
    deps.log(`"${step.name}": ${out.ok ? 'verified' : 'FAILED'} — ${out.message}`, out.ok ? 'ok' : 'error');
    results.push(out);
  }
  return { results, aiCalls, ok: results.every((r) => r.ok) };
}
