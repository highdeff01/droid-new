import type { LogEntry, WorkflowStep } from './types.js';
import type { StepOutcome } from './run-step.js';

/** Retries of a failed step before it is handed to the planner (Settings default). */
export const DEFAULT_STEP_RETRIES = 2;
/** Valid range of the per-step retries setting (matches its Settings slider). */
export const STEP_RETRIES_MIN = 0;
export const STEP_RETRIES_MAX = 5;

/** An outcome the ladder can climb: a step result, `halt` when a guardrail refused it. */
export type LadderOutcome = StepOutcome & { halt?: boolean };

/** Which rung of the ladder an attempt was. */
export type AttemptKind = 'first' | 'retry' | 'replan';

/** One logged attempt of a step: what the live-frame verification found, where it aimed and how it ended. */
export interface Attempt {
  /** 1-based number of the attempt within the step. */
  n: number;
  kind: AttemptKind;
  /** The re-verification of the target on the live frame (drift level and correction, post-action check). */
  verify: string;
  /** The corrected point the attempt aimed at (normalized). */
  at: { x: number; y: number };
  /** Native pixels of `at` on the frame the attempt was located on; null when it found none. */
  atPx: { x: number; y: number } | null;
  ok: boolean;
  message: string;
}

/** What the ladder needs from its host. */
export interface LadderDeps<O extends LadderOutcome> {
  /** Retries after the first attempt (clamped to the setting's range). */
  retries: number;
  /** One pass of the grounded pipeline: fresh live frame, template re-verify, drift/grounding correction, input. */
  run: (step: WorkflowStep) => Promise<O>;
  /** The guardrails checked before every rung (abort, kill-switch, loop-control stage); the refusal reason or null. */
  stopped: () => string | null;
  /** The planner's one re-plan of the step, told why it failed; null when there is none (AI off, target gone). */
  replan: (step: WorkflowStep, why: string) => Promise<WorkflowStep | null>;
  /** Called with every attempt as it ends. */
  onAttempt: (step: WorkflowStep, attempt: Attempt) => void;
  log: (message: string, tone: LogEntry['tone']) => void;
}

/** The ladder's result: the last outcome, every attempt, and whether the step failed after all its rungs. */
export interface LadderResult<O extends LadderOutcome> {
  out: O;
  attempts: Attempt[];
  /** True when retries and the re-plan were all spent and the step still failed (not when a guardrail stopped it). */
  exhausted: boolean;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** The live-frame verification an outcome carries, as one phrase. */
export function verifyText(out: LadderOutcome): string {
  const c = out.correction;
  const located = !out.live && !c ? 'target not verified on the live frame' : c ? `target verified (${c.level}, drift ${c.driftPx}px${c.driftPx ? `, corrected by (${c.dxPx}, ${c.dyPx})px` : ''})` : 'target verified';
  const after = out.check ? (out.check.changed ? '; screen changed after input' : '; no visible change after input') : '';
  return `${located}${after}`;
}

/** The attempt record of one outcome. */
export function toAttempt(n: number, kind: AttemptKind, out: LadderOutcome): Attempt {
  const frame = out.shot ?? out.live;
  const atPx = frame ? { x: Math.round(out.target.x * frame.srcW), y: Math.round(out.target.y * frame.srcH) } : null;
  return { n, kind, verify: verifyText(out), at: out.target, atPx, ok: out.ok, message: out.message };
}

const RUNG: Record<AttemptKind, (retries: number, a: Attempt) => string> = {
  first: () => 'first try',
  retry: (retries, a) => `retry ${a.n - 1}/${retries}`,
  replan: () => 're-planned',
};

/** One line for the log and the thinking timeline: rung, outcome, verify result, corrected coordinates and message. */
export function describeAttempt(a: Attempt, retries: number): string {
  const where = `at (${pct(a.at.x)}, ${pct(a.at.y)})${a.atPx ? ` = (${a.atPx.x}, ${a.atPx.y})px` : ''}`;
  return `Attempt ${a.n} (${RUNG[a.kind](retries, a)}) — ${a.ok ? 'OK' : 'FAILED'}: ${a.verify}; ${where}; ${a.message}`;
}

/** The habit avoid lesson of a step that failed after its retries and re-plan. */
export function avoidPattern(step: WorkflowStep, attempts: Attempt[]): string {
  const last = attempts[attempts.length - 1];
  const tried = attempts.map((a) => `(${pct(a.at.x)}, ${pct(a.at.y)})`).join(', ');
  return `${step.action} "${step.target ?? step.name}" failed after ${attempts.length} attempt(s) at ${tried}: ${last?.message ?? 'no attempt ran'}`;
}

const clampRetries = (n: number) => Math.min(STEP_RETRIES_MAX, Math.max(STEP_RETRIES_MIN, Math.floor(Number.isFinite(n) ? n : DEFAULT_STEP_RETRIES)));

/** Whether the ladder ends on this outcome: success, or a guardrail halted it. */
const settled = (out: LadderOutcome) => out.ok || !!out.halt;

/** The planner's re-plan, with a failure or a refusal logged and resolved as null. */
async function askReplan<O extends LadderOutcome>(step: WorkflowStep, why: string, deps: LadderDeps<O>): Promise<WorkflowStep | null> {
  try {
    const next = await deps.replan(step, why);
    if (!next) deps.log(`"${step.name}": no re-plan from the planner — giving up`, 'error');
    return next;
  } catch (error) {
    deps.log(`"${step.name}": re-plan failed (${errorText(error)}) — giving up`, 'error');
    return null;
  }
}

/**
 * The per-step retry ladder: the first attempt, then up to `retries` retries (each re-verifies
 * the target on a fresh live frame and re-corrects it through the same pipeline), then one
 * re-plan by the planner. Every rung is checked against the guardrails first and every attempt
 * is reported; a halted outcome (budget, abort, disarm) ends the ladder at once.
 */
export async function runLadder<O extends LadderOutcome>(step: WorkflowStep, deps: LadderDeps<O>): Promise<LadderResult<O>> {
  const retries = clampRetries(deps.retries);
  const attempts: Attempt[] = [];
  const attempt = async (s: WorkflowStep, kind: AttemptKind) => {
    const out = await deps.run(s);
    const a = toAttempt(attempts.length + 1, kind, out);
    attempts.push(a);
    deps.onAttempt(s, a);
    return out;
  };
  const halted = () => {
    const why = deps.stopped();
    if (why) deps.log(`"${step.name}": retry ladder stopped — ${why}`, 'warn');
    return !!why;
  };
  let out = await attempt(step, 'first');
  for (let r = 1; r <= retries; r++) {
    if (settled(out) || halted()) return { out, attempts, exhausted: false };
    deps.log(`"${step.name}": failed (${out.message}) — re-verifying and retrying (${r}/${retries})`, 'warn');
    out = await attempt(step, 'retry');
  }
  if (settled(out) || halted()) return { out, attempts, exhausted: false };
  deps.log(`"${step.name}": failed after ${retries} retr${retries === 1 ? 'y' : 'ies'} — handing it to the planner for one re-plan`, 'warn');
  const next = await askReplan(step, out.message, deps);
  if (!next || halted()) return { out, attempts, exhausted: !next };
  out = await attempt(next, 'replan');
  return { out, attempts, exhausted: !settled(out) };
}
