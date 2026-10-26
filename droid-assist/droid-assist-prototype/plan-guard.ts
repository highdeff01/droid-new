import type { WorkflowStep } from './types.js';

/** Re-plans allowed per goal while the screen state stays the same (the first plan is not a re-plan). */
export const REPLAN_CAP = 3;

/** Whether a plan request may call the model; `log` is the one line to log when the guard trips (null: already logged). */
export type PlanGate = { run: true } | { run: false; log: string | null };

/** What a finished model plan was: new steps to apply, or the same steps as the previous plan. */
export type PlanVerdict = 'fresh' | 'duplicate';

interface GuardState {
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
 * Re-plan loop guard for one session: per goal (each goal keeps its own count, so interleaving
 * goals never resets another) and screen state (newest frame + step status changes) it allows
 * the first plan plus `cap` re-plans, and stops calling the model once a re-plan came back
 * identical to that goal's previous one. A changed screen resets that goal's count.
 */
export function createPlanGuard(cap = REPLAN_CAP) {
  const goals = new Map<string, GuardState>();
  let last = '';

  const stateFor = (goal: string, screen: string): GuardState => {
    const s = goals.get(goal);
    if (s && s.screen === screen) return s;
    const fresh = { screen, calls: 0, signature: null, duplicate: false, capped: false };
    goals.set(goal, fresh);
    return fresh;
  };

  /** Called before the model is asked to plan `goal` on screen state `screen`; counts the call when it runs. */
  const before = (goal: string, screen: string): PlanGate => {
    last = sameGoal(goal);
    const s = stateFor(last, screen);
    if (s.duplicate) return { run: false, log: null };
    if (s.calls > cap) {
      const log = s.capped ? null : `Re-plan cap reached for "${goal.trim()}": ${cap} re-plan(s) on an unchanged screen — not asking the model again until the screen or a step changes`;
      s.capped = true;
      return { run: false, log };
    }
    s.calls++;
    return { run: true };
  };

  /** Called with the steps the last allowed plan produced; a repeat of that goal's previous plan marks it as settled. */
  const after = (steps: WorkflowStep[]): PlanVerdict => {
    const s = goals.get(last);
    if (!s) return 'fresh';
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
