import type { WorkflowStep } from './types.js';

/** Valid range and default of the "take a break" reminder interval, in minutes. */
export const BREAK_MINUTES_RANGE: [number, number] = [5, 120];
export const DEFAULT_BREAK_MINUTES = 45;

/** How much slower relaxation mode runs the monitor and watcher loops and each step's delay. */
export const RELAX_FACTOR = 2;
/** Extra calm pause before every real step in relaxation mode. */
export const RELAX_PAUSE_MS = 1500;
/** The bridge's default delay before an action, used when a step carries no recorded pause. */
const DEFAULT_STEP_DELAY_MS = 200;

/** An interval as relaxation mode runs it: RELAX_FACTOR times longer when on. */
export const relaxInterval = (ms: number, relax: boolean) => (relax ? ms * RELAX_FACTOR : ms);

/** A step as relaxation mode runs it: its humanized pause doubled plus the calm pause; unchanged when off. */
export function relaxStep(step: WorkflowStep, relax: boolean): WorkflowStep {
  if (!relax) return step;
  return { ...step, delayMs: (step.delayMs ?? DEFAULT_STEP_DELAY_MS) * RELAX_FACTOR + RELAX_PAUSE_MS };
}

/** Background agent testing (the watcher's test clicks) runs only outside relaxation mode. */
export const backgroundTestsAllowed = (relax: boolean) => !relax;

/** The break-reminder period in ms. */
export const breakPeriodMs = (minutes: number) => minutes * 60_000;

/** The text of a break reminder after `minutes` of activity. */
export const breakText = (minutes: number) => `Time for a short break — ${minutes} minutes have passed. Stretch, look away from the screen and breathe.`;
