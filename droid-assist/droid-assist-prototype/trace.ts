import type { Frame, LogEntry, WorkflowStep } from './types.js';
import { isStoredFrame, toStoredFrame, type StoredFrame } from './frame-codec.js';
import { executeStep, type AiFreeDeps, type AiFreeOutcome } from './ai-free.js';
import { runLadder, type Attempt } from './retry-ladder.js';

/**
 * Trace mode: every real action recorded with its full context (before/after frames, planned vs actual
 * coordinates, verification verdict, timing), exported/imported as a file, and replayed with real
 * dispatches, per-step screenshot verification, drift correction and the retry ladder.
 */

type Point = { x: number; y: number };

/** How a traced action's verification came out; `unverifiable` when it has no after-frame to check. */
export type TraceVerdict = 'verified' | 'failed' | 'unverifiable';

/** One traced action. */
export interface TraceStep {
  /** The step as planned (no run evidence or frames). */
  step: WorkflowStep;
  /** The screen just before the action: the template a replay matches against. */
  beforeFrame: Frame;
  /** The screen just after the action: what a replay verifies against; absent when none was captured. */
  afterFrame?: Frame;
  planned: Point;
  /** Where the input actually went (drift-corrected / learned point). */
  actual: Point;
  verdict: TraceVerdict;
  message: string;
  startedAt: number;
  ms: number;
}

/** A recorded trace. */
export interface Trace {
  goal: string;
  startedAt: number;
  steps: TraceStep[];
}

/** File format version of an exported trace. */
export const TRACE_FORMAT = 1;
/** File extension of an exported trace. */
export const TRACE_EXTENSION = '.droidtrace.json';

/** A trace file that cannot be imported; the message says which step and field. */
export class TraceImportError extends Error {
  override name = 'TraceImportError';
}

/** A step without its run evidence and frames. */
const plainStep = ({ refFrame: _r, beforeFrame: _b, afterFrame: _a, shot: _s, ...s }: WorkflowStep): WorkflowStep => s;

/** A new, empty trace. */
export const newTrace = (goal: string, now = Date.now()): Trace => ({ goal, startedAt: now, steps: [] });

/** One executed step as a trace entry; null when it never got a before-frame (nothing ran). */
export function traceStep(step: WorkflowStep, out: AiFreeOutcome): TraceStep | null {
  if (!out.live) return null;
  const verdict: TraceVerdict = !out.shot ? 'unverifiable' : out.ok ? 'verified' : 'failed';
  return {
    step: plainStep(step),
    beforeFrame: out.live,
    ...(out.shot ? { afterFrame: out.shot } : {}),
    planned: out.planned,
    actual: out.target,
    verdict,
    message: out.message,
    startedAt: out.startedAt,
    ms: out.ms,
  };
}

/** `trace` with one more executed step recorded (unchanged when the step never ran). */
export function recordStep(trace: Trace, step: WorkflowStep, out: AiFreeOutcome): Trace {
  const entry = traceStep(step, out);
  return entry ? { ...trace, steps: [...trace.steps, entry] } : trace;
}

type StoredTraceStep = Omit<TraceStep, 'beforeFrame' | 'afterFrame'> & { beforeFrame: StoredFrame; afterFrame?: StoredFrame };

/** The trace as file text: frames as their JPEG data URLs, pixel buffers dropped. */
export function exportTrace(trace: Trace): string {
  const steps: StoredTraceStep[] = trace.steps.map(({ beforeFrame, afterFrame, ...s }) => ({ ...s, beforeFrame: toStoredFrame(beforeFrame), ...(afterFrame ? { afterFrame: toStoredFrame(afterFrame) } : {}) }));
  return JSON.stringify({ format: TRACE_FORMAT, goal: trace.goal, startedAt: trace.startedAt, steps }, null, 2);
}

const isPoint = (v: unknown): v is Point => !!v && typeof (v as Point).x === 'number' && typeof (v as Point).y === 'number';

/** The parsed file's steps, checked field by field; throws naming the first bad step. */
function checkSteps(raw: unknown): StoredTraceStep[] {
  if (!Array.isArray(raw)) throw new TraceImportError('trace file has no steps list');
  return raw.map((s: Record<string, unknown>, i) => {
    const at = `step ${i + 1}`;
    if (!s || typeof s !== 'object' || !s.step || typeof (s.step as WorkflowStep).action !== 'string') throw new TraceImportError(`${at}: missing its step`);
    if (!isStoredFrame(s.beforeFrame)) throw new TraceImportError(`${at}: missing its before frame (the replay template)`);
    if (!isPoint(s.planned) || !isPoint(s.actual)) throw new TraceImportError(`${at}: missing planned or actual coordinates`);
    return s as unknown as StoredTraceStep;
  });
}

/** Decodes a stored frame into a full Frame (JPEG → pixel buffer); null when it cannot be decoded. */
export type FrameDecoder = (stored: StoredFrame) => Promise<Frame | null>;

/** One stored step back as a trace step; an after-frame that is missing or undecodable marks it unverifiable. */
async function loadStep(s: StoredTraceStep, i: number, decode: FrameDecoder): Promise<TraceStep> {
  const beforeFrame = await decode(s.beforeFrame);
  if (!beforeFrame) throw new TraceImportError(`step ${i + 1}: its before frame could not be decoded`);
  const afterFrame = s.afterFrame && isStoredFrame(s.afterFrame) ? await decode(s.afterFrame) : null;
  const { afterFrame: _a, ...rest } = s;
  if (!afterFrame) return { ...rest, beforeFrame, verdict: 'unverifiable' };
  return { ...rest, beforeFrame, afterFrame };
}

/** A trace file read back: every step needs its before frame and coordinates; a missing after frame flags the step unverifiable. */
export async function importTrace(text: string, decode: FrameDecoder): Promise<Trace> {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new TraceImportError('trace file is not JSON');
  }
  if (raw?.format !== TRACE_FORMAT) throw new TraceImportError(`unsupported trace format ${String(raw?.format)} (expected ${TRACE_FORMAT})`);
  const steps = checkSteps(raw.steps);
  const loaded = await Promise.all(steps.map((s, i) => loadStep(s, i, decode)));
  return { goal: typeof raw.goal === 'string' ? raw.goal : '', startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : 0, steps: loaded };
}

/** A traced step as a replayable workflow step: matched against its before frame at its planned point. */
export const replayableStep = (t: TraceStep): WorkflowStep => ({ ...t.step, x: t.planned.x, y: t.planned.y, refFrame: t.beforeFrame, status: 'pending' });

/** What a replay needs: the AI-free pipeline plus the retry ladder's guardrails and re-plan. */
export interface ReplayDeps extends Omit<AiFreeDeps, 'expected' | 'consultAi'> {
  retries: number;
  stopped: () => string | null;
  /** The ladder's last rung (AI re-plan / takeover); null when there is none. */
  replan: (step: WorkflowStep, why: string) => Promise<WorkflowStep | null>;
  onAttempt?: (step: WorkflowStep, attempt: Attempt) => void;
  log: (message: string, tone: LogEntry['tone']) => void;
}

/** One replayed step: its ladder attempts and final outcome. */
export interface ReplayedStep {
  index: number;
  out: AiFreeOutcome;
  attempts: Attempt[];
}

/** A finished replay: every step's result and the new trace it recorded. */
export interface ReplayResult {
  steps: ReplayedStep[];
  trace: Trace;
  ok: boolean;
}

/**
 * Re-executes a trace with real dispatches: each step template-matched on a fresh frame against its
 * traced before-frame, drift-corrected, sent, and verified against its traced after-frame, through the
 * retry ladder (first try → retries → re-plan). A step stopped by a guardrail ends the replay.
 */
export async function replayTrace(trace: Trace, deps: ReplayDeps): Promise<ReplayResult> {
  const steps: ReplayedStep[] = [];
  let recorded = newTrace(trace.goal, (deps.now ?? Date.now)());
  const expected = new Map(trace.steps.map((t) => [t.step.id, t.afterFrame]));
  const run = { ...deps, expected: (s: WorkflowStep) => expected.get(s.id) };
  for (const [index, t] of trace.steps.entries()) {
    const step = replayableStep(t);
    const ladder = await runLadder(step, {
      retries: deps.retries,
      run: (s) => executeStep(s, run),
      stopped: deps.stopped,
      replan: deps.replan,
      onAttempt: deps.onAttempt ?? (() => undefined),
      log: deps.log,
    });
    steps.push({ index, out: ladder.out, attempts: ladder.attempts });
    recorded = recordStep(recorded, step, ladder.out);
    if (!ladder.out.ok && !ladder.exhausted) break;
  }
  return { steps, trace: recorded, ok: steps.length === trace.steps.length && steps.every((s) => s.out.ok) };
}
