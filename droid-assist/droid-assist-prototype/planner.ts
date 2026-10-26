import type { Frame, LearnedPattern, SavedCard, StepAction, WorkflowStep } from './types.js';
import { AiError, VIEW_H, VIEW_W, parseJsonReply, toUnit } from './ai.js';
import type { AskFn } from './ai.js';

let seq = 0;
/** A short unique id. */
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

const STOP = new Set(['the', 'and', 'for', 'with', 'then', 'step', 'steps', 'click', 'button', 'main', 'action', 'please', 'into', 'from', 'that', 'this', 'app', 'flow', 'workflow']);
/** Different wordings of the same intent map to one word. */
const SYNONYMS: Record<string, string> = {
  launch: 'open', start: 'open', run: 'open', load: 'open',
  dismiss: 'close', exit: 'close', quit: 'close', shut: 'close',
  find: 'search', lookup: 'search', look: 'search', google: 'search',
  enter: 'type', write: 'type', input: 'type',
  calculator: 'calc', calculate: 'calc', compute: 'calc',
  video: 'play', music: 'play', song: 'play', ad: 'popup', ads: 'popup', advert: 'popup',
};
/** Folds plural and verb endings so "opening the calculators" matches "open calculator". */
function stem(w: string): string {
  if (w.length <= 4) return w;
  const cut = w.replace(/(ing|ed|es|s)$/, '');
  return cut === w ? w : cut.replace(/(.)\1$/, '$1');
}
const canonical = (w: string) => SYNONYMS[w] ?? SYNONYMS[stem(w)] ?? stem(w);
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => !STOP.has(w)).map(canonical).filter((w) => w.length > 2 && !STOP.has(w)));

/**
 * How much of `goal` is covered by `text` (0..1): the share of the goal's meaningful
 * words found in the candidate. Short goals match long saved descriptions well.
 */
export function similarity(goal: string, text: string): number {
  const A = words(goal);
  const B = words(text);
  if (!A.size || !B.size) return 0;
  let both = 0;
  A.forEach((w) => B.has(w) && both++);
  return both / A.size;
}

/** The saved card most similar to `text`, when it is close enough to reuse. */
export function findSimilar(text: string, cards: SavedCard[], min = 0.5): SavedCard | null {
  let best: SavedCard | null = null;
  let score = min;
  for (const card of cards) {
    const s = similarity(text, `${card.name} ${card.description} ${card.steps.map((st) => st.name).join(' ')}`);
    if (s >= score) {
      best = card;
      score = s;
    }
  }
  return best;
}

const ACTIONS: ReadonlySet<StepAction> = new Set<StepAction>(['click', 'type', 'key', 'open_app', 'wait', 'search', 'calc', 'media']);

/** System prompt for the planner: the reply contract the model must follow. */
export const PLAN_SYSTEM = `You are Droid Assist, an agent that controls a computer screen. You see a screenshot (${VIEW_W}x${VIEW_H}) of the user's screen.
Plan the concrete steps that achieve the user's goal on THIS screen. Look at the screenshot and target real visible controls.
Reply ONLY with JSON: {"steps":[{"name":string,"action":"click"|"type"|"key"|"open_app"|"wait"|"search"|"calc"|"media","x":number,"y":number,"text"?:string}]}
x and y are the target's center as fractions 0..1 of the screenshot width/height. "text" is the text to type, the key to press, the search query or the arithmetic expression.`;

/** A plan the assistant proposes, with where it came from. */
export interface PlanResult {
  steps: WorkflowStep[];
  source: string;
}

/** Converts one model step into a WorkflowStep; throws AiError when it breaks the contract. */
function toStep(raw: unknown, frame: Frame | null): WorkflowStep {
  const s = (raw ?? {}) as Record<string, unknown>;
  const action = s.action as StepAction;
  if (!ACTIONS.has(action)) throw new AiError(`AI proposed an unknown action "${String(s.action)}"`);
  const step: WorkflowStep = {
    id: uid('step'),
    name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : action,
    action,
    x: toUnit(s.x ?? 0.5, VIEW_W),
    y: toUnit(s.y ?? 0.5, VIEW_H),
    status: 'pending',
  };
  if (s.text !== undefined && s.text !== null) step.text = String(s.text);
  if (action === 'click' && frame) step.refFrame = frame;
  return step;
}

/** Parses the planner's JSON reply into steps; throws AiError on malformed or empty plans. */
export function parsePlan(reply: string, frame: Frame | null): WorkflowStep[] {
  const steps = parseJsonReply(reply).steps;
  if (!Array.isArray(steps) || !steps.length) throw new AiError('AI returned no steps for this goal');
  return steps.map((s) => toStep(s, frame));
}

/** Most learned patterns sent with one planning ask. */
export const PATTERN_CONTEXT_LIMIT = 8;

/**
 * The learned patterns that apply to `goal`: general ones (no context) and those whose
 * pattern or context shares a meaningful word with the goal, newest first.
 */
export function relevantPatterns(goal: string, patterns: LearnedPattern[]): LearnedPattern[] {
  const goalWords = words(goal);
  const related = (p: LearnedPattern) => !p.context.trim() || [...words(`${p.context} ${p.pattern}`)].some((w) => goalWords.has(w));
  return patterns.filter(related).slice(0, PATTERN_CONTEXT_LIMIT);
}

/** A learned pattern as one planning-context line. */
export const patternLine = (p: LearnedPattern) => `[Learned ${p.kind}] ${p.pattern}${p.context ? ` (from: ${p.context})` : ''}`;

/** A saved step as a fresh pending step that starts at its drift-corrected position. */
const reuseStep = (s: WorkflowStep): WorkflowStep => ({
  ...s,
  id: uid('step'),
  status: 'pending',
  x: s.correctedX ?? s.x,
  y: s.correctedY ?? s.y,
  correctedX: undefined,
  correctedY: undefined,
});

/**
 * Fills a workflow from a goal: reuses a similar saved workflow when one exists (no model
 * call, steps start at their last drift-corrected positions); otherwise the model plans the
 * steps from the goal, the live frame, the recent context and the learned patterns relevant
 * to this goal. Rejects with AiError when the model is unreachable or its reply is unusable.
 */
export async function planFromGoal(goal: string, cards: SavedCard[], frame: Frame | null, ask: AskFn, context: string[] = [], patterns: LearnedPattern[] = []): Promise<PlanResult> {
  const similar = findSimilar(goal, cards);
  if (similar) {
    return {
      source: `Reused saved workflow "${similar.name}" (similar goal, drift-corrected coordinates)`,
      steps: similar.steps.map(reuseStep),
    };
  }
  const lessons = relevantPatterns(goal, patterns).map(patternLine);
  const reply = await ask({ system: PLAN_SYSTEM, prompt: `Goal: ${goal}`, frame, context: [...lessons, ...context], json: true });
  const source = lessons.length ? `AI planned from the goal and the live screen, applying ${lessons.length} learned pattern(s)` : 'AI planned from the goal and the live screen';
  return { steps: parsePlan(reply, frame), source };
}

/** A generated name + description for a workflow. */
export function generateCard(steps: WorkflowStep[], goal: string): { name: string; description: string } {
  const verbs = Array.from(new Set(steps.map((s) => s.action))).join(', ');
  const name = goal.trim() ? goal.trim().replace(/^\w/, (c) => c.toUpperCase()).slice(0, 48) : `Workflow (${steps.length} steps)`;
  return { name, description: `${steps.length} step(s): ${verbs || 'empty'}. ${steps.map((s) => s.name).slice(0, 3).join(' → ')}` };
}

/** Safely evaluates a plain arithmetic expression; null when it is not one. */
export function calculate(expr: string): number | null {
  if (!/^[0-9+\-*/(). ]+$/.test(expr)) return null;
  try {
    const value = Function(`"use strict"; return (${expr});`)() as unknown;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
