import type { StepAction, WorkflowStep } from './types.js';
import type { NotificationDraft } from './notifications.js';

/** The parts of a step its intention sentence names. */
export type IntentStep = Pick<WorkflowStep, 'name' | 'action' | 'x' | 'y' | 'text' | 'target' | 'endX' | 'endY' | 'endTarget' | 'repeat'>;

const pct = (v: number) => `${Math.round(v * 100)}%`;
/** The step's target with its normalized screen position: `files icon (12%, 40%)`. */
const spot = (s: IntentStep) => `${s.target ?? s.name} (${pct(s.x)}, ${pct(s.y)})`;
const drop = (s: IntentStep) => `${s.endTarget ?? 'the drop point'} (${pct(s.endX ?? s.x)}, ${pct(s.endY ?? s.y)})`;
const times = (s: IntentStep) => ((s.repeat ?? 1) > 1 ? ` ×${s.repeat}` : '');

/** What the AI is about to do, one phrase per action kind. */
const PHRASES: Record<StepAction, (s: IntentStep) => string> = {
  click: (s) => `Moving to ${spot(s)} to click it`,
  double_click: (s) => `Moving to ${spot(s)} to double-click it`,
  move: (s) => `Moving to ${spot(s)} to hover over it`,
  drag: (s) => `Dragging ${spot(s)} to ${drop(s)}`,
  scroll: (s) => `Moving to ${spot(s)} to scroll${s.text ? ` ${s.text}` : ''}`,
  type: (s) => `Typing "${s.text ?? ''}" into ${spot(s)}`,
  key: (s) => `Pressing ${s.text ?? 'a key'}${times(s)}`,
  open_app: (s) => `Opening ${s.text ?? s.name}`,
  wait: (s) => `Waiting${s.text ? ` for ${s.text}` : ''}`,
  search: (s) => `Searching for "${s.text ?? s.name}"`,
  calc: (s) => `Calculating ${s.text ?? s.name}`,
  media: (s) => `Sending the media control ${s.text ?? s.name}`,
  measure: (s) => `Measuring ${s.text ?? s.target ?? s.name}`,
  snip: (s) => `Snipping ${spot(s)}`,
};

/** The reason given when the planner recorded none: the step's place in the plan and the goal. */
export function defaultWhy(step: Pick<WorkflowStep, 'name'>, goal: string): string {
  const g = goal.trim();
  return g ? `it is step "${step.name}" toward "${g}"` : `it is step "${step.name}" of the plan`;
}

/** The intention sentence for a step: "Moving to files icon (12%, 40%) to click it because …". */
export function intentionText(step: IntentStep, why: string): string {
  return `${PHRASES[step.action](step)} because ${why.trim().replace(/[.\s]+$/, '')}.`;
}

/** The notification stating an AI action's intention; a retry names its attempt so it is not folded into the first. */
export function intentionDraft(intent: string, attempt: number): NotificationDraft {
  return { source: 'AI intent', category: 'intent', severity: 'info', title: attempt > 1 ? `${intent} (attempt ${attempt})` : intent };
}
