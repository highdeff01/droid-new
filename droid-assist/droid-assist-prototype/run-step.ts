import type { Frame, LogEntry, WorkflowStep } from './types.js';
import { POINTER_ACTIONS } from './types.js';
import { correctDrift, reverify, type DriftCorrection, type Reverify } from './drift.js';
import { sendToBridge } from './bridge.js';
import type { TargetCheck } from './assist-ai.js';

type Point = { x: number; y: number };

/** The AI grounding pass: confirm a proposed point on the live frame, or re-ask for it once. */
export interface Grounding {
  /** Is the step's named target at `p` on `live`? (asked on a zoomed crop around `p`) */
  confirm: (live: Frame, step: WorkflowStep, p: Point) => Promise<TargetCheck>;
  /** The planner re-asked once with why the last point was rejected; null when it cannot see the target. */
  relocate: (live: Frame, step: WorkflowStep, feedback: string) => Promise<Point | null>;
}

/** What the real-input pipeline needs from its host. */
export interface StepDeps {
  bridgeUrl: string;
  /** Bridge auth token sent with every bridge call; never logged. */
  bridgeToken: string;
  /** A fresh real desktop screenshot; throws with the reason when there is none. */
  capture: () => Promise<Frame>;
  /** Live-frame checks before giving up on a target that cannot be found. */
  attempts: number;
  /** Pause between those checks, in ms. */
  retryMs: number;
  /** False for the self-test: verify and correct, but send no input. */
  dispatch: boolean;
  log: (message: string, tone: LogEntry['tone']) => void;
  /** Present while the AI is online: every named pointer target is confirmed before input is sent. */
  grounding?: Grounding;
  /**
   * Gate for the one corrected retry of a missed step (abort, arm, budget); returns the refusal
   * reason or null when the retry may be sent. No retry is attempted without it.
   */
  gateRetry?: () => string | null;
  /** A learned habit's remembered position of the step's target, found on `live`; null when there is none or it did not match. */
  seed?: (live: Frame, step: WorkflowStep) => Point | null;
  /** The coordinate learner's position of the step's target, template-matched on `live`; null when unknown or not found. A hit skips the AI grounding call. */
  learned?: (live: Frame, step: WorkflowStep) => Point | null;
  /** Called with the point the AI grounding pass confirmed for the step's target. */
  onVerified?: (live: Frame, step: WorkflowStep, p: Point) => void;
}

/** The corrected retry of a missed step: the measured miss offset and the point retried. */
export interface RetryInfo {
  /** Expected − actual hit point, in native pixels. */
  dxPx: number;
  dyPx: number;
  /** Where the retry was aimed (normalized). */
  at: { x: number; y: number };
  ok: boolean;
  message: string;
}

/** The real result of one step. `executed` is true only when the PC confirmed the input. */
export interface StepOutcome {
  ok: boolean;
  executed: boolean;
  message: string;
  target: { x: number; y: number };
  /** A drag's drift-corrected, grounded drop point. */
  end?: { x: number; y: number };
  correction?: DriftCorrection;
  /** The live frame the step was located on, just before the input. */
  live?: Frame;
  /** Screenshot taken after the step was executed. */
  shot?: Frame;
  check?: Reverify;
  /** The once-per-step corrected retry, when the first attempt missed. */
  retry?: RetryInfo;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A step with no recorded screenshot has nothing to match: it runs where it was recorded. */
function noTemplate(step: WorkflowStep): DriftCorrection {
  return { level: 'green', x: step.x, y: step.y, dxPx: 0, dyPx: 0, driftPx: 0, regionDistance: 0, matchDistance: 0, widened: false };
}

/** One line: the drift measured for a step and the correction applied, in pixels. */
export function describeCorrection(step: WorkflowStep, c: DriftCorrection, live: Frame): string {
  if (!step.refFrame) return `"${step.name}": no reference screenshot — drift 0px, no correction, target (${Math.round(c.x * live.srcW)}, ${Math.round(c.y * live.srcH)})px`;
  const fixed = c.driftPx ? `corrected by (${c.dxPx >= 0 ? '+' : ''}${c.dxPx}, ${c.dyPx >= 0 ? '+' : ''}${c.dyPx})px${c.widened ? ' after a wide search' : ''}` : 'no correction needed';
  return `"${step.name}": drift ${c.driftPx}px (${c.level}, match ${c.matchDistance.toFixed(3)}) — ${fixed}, target (${Math.round(c.x * live.srcW)}, ${Math.round(c.y * live.srcH)})px`;
}

/** Verifies the step's target on fresh live frames until it is found or the attempts run out. */
async function locateTarget(step: WorkflowStep, deps: StepDeps): Promise<{ live: Frame; correction: DriftCorrection } | { error: string }> {
  const n = Math.max(1, deps.attempts);
  let best = 1;
  for (let k = 1; k <= n; k++) {
    let live: Frame;
    try {
      live = await deps.capture();
    } catch (error) {
      return { error: `Could not capture the live screen: ${errorText(error)}` };
    }
    if (!step.refFrame) return { live, correction: noTemplate(step) };
    const correction = correctDrift(step.refFrame.data, live.data, step.x, step.y, live.srcW, live.srcH);
    if (correction.level !== 'red') return { live, correction };
    best = Math.min(best, correction.matchDistance);
    deps.log(`"${step.name}": target not found on live check ${k}/${n} (best match ${correction.matchDistance.toFixed(3)})`, 'warn');
    if (k < n) await sleep(deps.retryMs);
  }
  return { error: `Target of "${step.name}" not found on the live screen after ${n} check(s) (best match ${best.toFixed(3)}) — not executed` };
}

/** Re-captures after the action and logs what changed around the target. */
async function verifyAfter(step: WorkflowStep, before: Frame, target: { x: number; y: number }, deps: StepDeps): Promise<{ shot?: Frame; check?: Reverify }> {
  let shot: Frame;
  try {
    shot = await deps.capture();
  } catch (error) {
    deps.log(`"${step.name}": re-verify skipped — no post-action screenshot (${errorText(error)})`, 'warn');
    return {};
  }
  const check = reverify(before.data, shot.data, target.x, target.y);
  const what = `target Δ ${check.targetChange.toFixed(3)}, frame Δ ${check.frameChange.toFixed(3)}`;
  deps.log(`"${step.name}": re-verified — ${check.changed ? `screen changed (${what})` : `no visible change (${what})`}`, check.changed ? 'ok' : 'warn');
  return { shot, check };
}

/** A point as native pixels on `live`, for messages. */
const px = (p: Point, live: Frame) => `(${Math.round(p.x * live.srcW)}, ${Math.round(p.y * live.srcH)})px`;

/**
 * The AI grounding pass for a named pointer target: confirm the target is at the proposed
 * point on a zoomed crop; if not, re-ask the planner once with why and confirm its new point.
 * Never resolves a point the model did not confirm.
 */
export async function groundTarget(step: WorkflowStep, live: Frame, p: Point, g: Grounding, log: StepDeps['log']): Promise<{ point: Point } | { error: string }> {
  const name = step.target ?? step.name;
  try {
    const first = await g.confirm(live, step, p);
    if (first.visible) {
      log(`"${step.name}": AI confirmed "${name}" at ${px(p, live)} — ${first.reason}`, 'ok');
      return { point: p };
    }
    log(`"${step.name}": AI did not see "${name}" at ${px(p, live)} (${first.reason}) — re-asking the planner once`, 'warn');
    const next = await g.relocate(live, step, `"${name}" is not at that point: ${first.reason}`);
    if (!next) return { error: `Target "${name}" not located: AI rejected ${px(p, live)} (${first.reason}) and the re-plan found no such target — not executed` };
    const second = await g.confirm(live, step, next);
    if (second.visible) {
      log(`"${step.name}": AI confirmed "${name}" at the re-planned ${px(next, live)} — ${second.reason}`, 'ok');
      return { point: next };
    }
    return { error: `Target "${name}" not located: AI rejected ${px(p, live)} (${first.reason}) and the re-planned ${px(next, live)} (${second.reason}) — not executed` };
  } catch (error) {
    return { error: `Target "${name}" could not be verified (AI unavailable: ${errorText(error)}) — not executed` };
  }
}

/** Whether a step's point must pass the AI grounding pass before input is sent. */
const needsGrounding = (step: WorkflowStep) => POINTER_ACTIONS.has(step.action) && !!step.target;

const onScreen = (v: number | undefined) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** Why a drag's release point cannot be used (missing or off-screen); null for a valid one or a non-drag step. */
export function dragEndError(step: WorkflowStep): string | null {
  if (step.action !== 'drag') return null;
  if (step.endX === undefined || step.endY === undefined) return `Drag "${step.name}" has no end point — a drag needs both a start and an end; not executed`;
  if (!onScreen(step.endX) || !onScreen(step.endY)) return `Drag "${step.name}" ends off-screen at (${(step.endX * 100).toFixed(1)}%, ${(step.endY * 100).toFixed(1)}%) — not executed`;
  return null;
}

/**
 * A drag's drop point on the live frame: drift-corrected against the reference screenshot like
 * the start (a drop point that no longer matches is kept as planned, since an empty spot can
 * change), then confirmed by the AI as the named end target.
 */
async function groundEnd(step: WorkflowStep, live: Frame, deps: StepDeps): Promise<{ point: Point } | { error: string }> {
  const planned = { x: step.endX!, y: step.endY! };
  const c = step.refFrame ? correctDrift(step.refFrame.data, live.data, planned.x, planned.y, live.srcW, live.srcH) : null;
  const end = c && c.level !== 'red' ? { x: c.x, y: c.y } : planned;
  const how = !c ? 'no reference screenshot, as planned' : c.level === 'red' ? 'reference no longer matches there, kept as planned' : `drift ${c.driftPx}px`;
  deps.log(`"${step.name}": drop point ${px(end, live)} (${how})`, c?.driftPx ? 'warn' : 'info');
  if (!deps.grounding || !step.endTarget) return { point: end };
  return groundTarget({ ...step, target: step.endTarget }, live, end, deps.grounding, deps.log);
}

/**
 * The point a pointer step starts from: a matching habit's remembered position when it is
 * found on the live frame, otherwise the drift-corrected one.
 */
function startPoint(step: WorkflowStep, live: Frame, correction: DriftCorrection, deps: StepDeps): Point {
  const fallback = { x: correction.x, y: correction.y };
  if (!POINTER_ACTIONS.has(step.action) || !deps.seed) return fallback;
  const seeded = deps.seed(live, step);
  if (!seeded) return fallback;
  deps.log(`"${step.name}": habit seed — remembered "${step.target ?? step.name}" found at ${px(seeded, live)}`, 'info');
  return seeded;
}

/**
 * The single real-input pipeline: verify the target on a live desktop frame, correct its
 * drift (or start from a learned habit's remembered position), confirm a named target with
 * the AI, perform the input through the bridge at that position, then re-verify. A drag
 * grounds and drift-corrects both its start and its end.
 */
export async function runStep(step: WorkflowStep, deps: StepDeps): Promise<StepOutcome> {
  const badEnd = dragEndError(step);
  if (badEnd) return { ok: false, executed: false, message: badEnd, target: { x: step.x, y: step.y } };
  const found = await locateTarget(step, deps);
  if ('error' in found) return { ok: false, executed: false, message: found.error, target: { x: step.x, y: step.y } };
  const { live, correction } = found;
  deps.log(describeCorrection(step, correction, live), correction.driftPx ? 'warn' : 'info');
  const learned = POINTER_ACTIONS.has(step.action) ? deps.learned?.(live, step) ?? null : null;
  if (learned) deps.log(`"${step.name}": learned coordinates — "${step.target ?? step.name}" found at ${px(learned, live)}, no AI grounding needed`, 'info');
  let target = learned ?? startPoint(step, live, correction, deps);
  if (!learned && needsGrounding(step) && deps.grounding) {
    const grounded = await groundTarget(step, live, target, deps.grounding, deps.log);
    if ('error' in grounded) return { ok: false, executed: false, message: grounded.error, target, correction };
    target = grounded.point;
    deps.onVerified?.(live, step, target);
  }
  let end: Point | undefined;
  if (step.action === 'drag') {
    const e = await groundEnd(step, live, deps);
    if ('error' in e) return { ok: false, executed: false, message: e.error, target, correction, live };
    end = e.point;
  }
  if (!deps.dispatch) return { ok: true, executed: false, message: 'verified on the live screen — self-test, not dispatched', target, end, correction, live };
  const sent = await sendToBridge(deps.bridgeUrl, { ...step, correctedX: target.x, correctedY: target.y, ...(end ? { endX: end.x, endY: end.y } : {}) }, live.srcW, live.srcH, { token: deps.bridgeToken });
  if (!sent.ok) return { ok: false, executed: false, message: sent.message, target, end, correction, live };
  const after = await verifyAfter(step, live, target, deps);
  const done: StepOutcome = { ok: true, executed: true, message: sent.message, target, end, correction, live, ...after };
  return retryMissed(step, done, deps);
}

/**
 * The measured miss of an executed pointer step that changed nothing: drift verification
 * re-locates the recorded target on the post-action shot (the expected point); the actual
 * hit is where the input was sent. Returns expected − actual (native px) and the corrected
 * point actual + delta. Null when there is nothing to measure or correct.
 */
export function missOffset(step: WorkflowStep, out: StepOutcome): { dxPx: number; dyPx: number; at: Point } | null {
  if (!POINTER_ACTIONS.has(step.action) || !step.refFrame || !out.executed || !out.shot || !out.check || out.check.changed) return null;
  const shot = out.shot;
  const expected = correctDrift(step.refFrame.data, shot.data, step.x, step.y, shot.srcW, shot.srcH);
  if (expected.level === 'red') return null;
  const dxPx = Math.round((expected.x - out.target.x) * shot.srcW);
  const dyPx = Math.round((expected.y - out.target.y) * shot.srcH);
  if (Math.hypot(dxPx, dyPx) < 1) return null;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { dxPx, dyPx, at: { x: clamp(out.target.x + dxPx / shot.srcW), y: clamp(out.target.y + dyPx / shot.srcH) } };
}

/** At most one corrected retry per step, through the host's guardrail gate, with the measured delta applied. */
async function retryMissed(step: WorkflowStep, out: StepOutcome, deps: StepDeps): Promise<StepOutcome> {
  const miss = missOffset(step, out);
  if (!miss || !deps.gateRetry) return out;
  const delta = `(${miss.dxPx >= 0 ? '+' : ''}${miss.dxPx}, ${miss.dyPx >= 0 ? '+' : ''}${miss.dyPx})px`;
  const refusal = deps.gateRetry();
  if (refusal) {
    deps.log(`"${step.name}": missed by ${delta} — corrected retry not sent: ${refusal}`, 'error');
    return { ...out, retry: { dxPx: miss.dxPx, dyPx: miss.dyPx, at: miss.at, ok: false, message: refusal } };
  }
  const shot = out.shot!;
  deps.log(`"${step.name}": missed by ${delta} — retrying once at ${px(miss.at, shot)}`, 'warn');
  const sent = await sendToBridge(deps.bridgeUrl, { ...step, correctedX: miss.at.x, correctedY: miss.at.y }, shot.srcW, shot.srcH, { token: deps.bridgeToken });
  const retry = { dxPx: miss.dxPx, dyPx: miss.dyPx, at: miss.at, ok: sent.ok, message: sent.message };
  if (!sent.ok) return { ...out, retry };
  const after = await verifyAfter(step, shot, miss.at, deps);
  return { ...out, target: miss.at, message: `${out.message}; corrected retry by ${delta}: ${sent.message}`, ...after, retry };
}
