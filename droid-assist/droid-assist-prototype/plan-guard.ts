import type { WorkflowStep } from './types.js';

/** Re-plans allowed per goal while the screen state stays the same (the first plan is not a re-plan). */
export const REPLAN_CAP = 3;

/** Whether a plan request may call the model; `log` is the one line to log when the guard trips (null: already logged). */
export type PlanGate = { run: true } | { run: false; log: string | null };

/** What a finished model plan was: new steps to apply, or the same steps as the previous plan. */
export type PlanVerdict = 'fresh' | 'duplicate';

interface GuardState {
  goal: string;
  screen: string;
  calls: number;
  signature: string | null;
  duplicate: boolean;
  capped: boolean;
}

const sameGoal = (goal: string) => goal.trim().toLowerCase();

/** The steps as the planner would act on them: action, target, text and position to 0.01. */
export function planSignature(steps: WorkflowStep[]): string {
  return JSON.stringify(steps.map((s) => [s.action, s.target ?? s.name, s.text ?? '', s.x.toFixed(2), s.y.toFixed(2)]));
}

/**
 * Re-plan loop guard for one session: per goal and screen state (newest frame + step status
 * changes) it allows the first plan plus `cap` re-plans, and stops calling the model once a
 * re-plan came back identical to the previous one. A new goal or a changed screen resets it.
 */
export function createPlanGuard(cap = REPLAN_CAP) {
  let s: GuardState = { goal: '', screen: '', calls: 0, signature: null, duplicate: false, capped: false };

  const reset = (goal: string, screen: string) => {
    if (s.goal === goal && s.screen === screen) return;
    s = { goal, screen, calls: 0, signature: null, duplicate: false, capped: false };
  };

  /** Called before the model is asked to plan `goal` on screen state `screen`; counts the call when it runs. */
  const before = (goal: string, screen: string): PlanGate => {
    reset(sameGoal(goal), screen);
    if (s.duplicate) return { run: false, log: null };
    if (s.calls > cap) {
      const log = s.capped ? null : `Re-plan cap reached for "${goal.trim()}": ${cap} re-plan(s) on an unchanged screen — not asking the model again until the screen or a step changes`;
      s.capped = true;
      return { run: false, log };
    }
    s.calls++;
    return { run: true };
  };

  /** Called with the steps a plan produced; a repeat of the previous plan marks the goal as settled. */
  const after = (steps: WorkflowStep[]): PlanVerdict => {
    const signature = planSignature(steps);
    if (signature === s.signature) {
      s.duplicate = true;
      return 'duplicate';
    }
    s.signature = signature;
    return 'fresh';
  };

  return { before, after };
}

/** The guard as used by the assist engine. */
export type PlanGuard = ReturnType<typeof createPlanGuard>;
