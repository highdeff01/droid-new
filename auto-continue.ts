import type { WorkflowStep } from './types.js';
import type { GoalCheck } from './assist-ai.js';

/** Default cap on continuation rounds (verify → re-plan → run) after the first run. */
export const DEFAULT_MAX_ITERATIONS = 5;

/** Iterations in a row with no verified progress that stop the loop. */
export const NO_PROGRESS_LIMIT = 2;

/** Why an auto-continue loop ended. */
export type ContinueStop = 'complete' | 'aborted' | 'halted' | 'cap' | 'no-progress';

/** One run of the current steps: what ran, and the message when the run had to halt (budget, disarm). */
export interface RunReport {
  ran: WorkflowStep[];
  halt: string | null;
}

/** What the loop drives: the run, the model's goal check and the re-plan, plus the abort latch. */
export interface ContinueDeps {
  maxIterations: number;
  aborted: () => boolean;
  /** Runs the current steps through the existing pipeline (retry/grounding included). */
  run: (iteration: number) => Promise<RunReport>;
  /** Asks the model whether the goal is complete on the live frame. */
  verify: (ran: WorkflowStep[], iteration: number) => Promise<GoalCheck>;
  /** Plans and installs the remaining steps. */
  plan: (ran: WorkflowStep[], check: GoalCheck, iteration: number) => Promise<void>;
}

/** How a loop ended: the reason, a one-line explanation and the continuation rounds made. */
export interface ContinueResult {
  stop: ContinueStop;
  detail: string;
  iterations: number;
}

/** What one goal check decides: stop (and why), or continue with the updated no-progress count. */
export type CheckVerdict = { stop: ContinueStop; detail: string } | { stop: null; stalls: number };

/**
 * The loop's ruling on one goal check after `iteration` continuation rounds: complete, too many
 * checks in a row without progress, the `maxIterations` cap, or continue. Shared by replay's
 * loop and Auto Act's continuation so both stop for the same reasons.
 */
export function judgeCheck(check: GoalCheck, stalls: number, iteration: number, maxIterations: number): CheckVerdict {
  if (check.complete) return { stop: 'complete', detail: `Goal verified complete — ${check.reason}` };
  const next = check.progress ? 0 : stalls + 1;
  if (next >= NO_PROGRESS_LIMIT) return { stop: 'no-progress', detail: `No verified progress in ${NO_PROGRESS_LIMIT} consecutive iterations — ${check.reason}` };
  if (iteration >= maxIterations) return { stop: 'cap', detail: `Max iterations (${maxIterations}) reached without verifying the goal — ${check.reason}` };
  return { stop: null, stalls: next };
}

/**
 * Auto-continue: run, verify the goal on the live frame, and while it is not complete plan the
 * remaining steps and run again. Stops when the goal is verified complete, a run halts (action
 * budget, disarm), abort fires, NO_PROGRESS_LIMIT checks in a row report no progress, or
 * `maxIterations` continuation rounds have run. Model failures reject.
 */
export async function autoContinue(deps: ContinueDeps): Promise<ContinueResult> {
  let stalls = 0;
  for (let iteration = 0; ; iteration++) {
    const end = (stop: ContinueStop, detail: string): ContinueResult => ({ stop, detail, iterations: iteration });
    const { ran, halt } = await deps.run(iteration);
    if (deps.aborted()) return end('aborted', 'Stopped by abort');
    if (halt) return end('halted', halt);
    const check = await deps.verify(ran, iteration);
    if (deps.aborted()) return end('aborted', 'Stopped by abort');
    const verdict = judgeCheck(check, stalls, iteration, deps.maxIterations);
    if (verdict.stop) return end(verdict.stop, verdict.detail);
    stalls = verdict.stalls;
    await deps.plan(ran, check, iteration + 1);
    if (deps.aborted()) return { stop: 'aborted', detail: 'Stopped by abort', iterations: iteration + 1 };
  }
}
