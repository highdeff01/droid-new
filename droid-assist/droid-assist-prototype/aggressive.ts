import type { Frame, StepAction, WorkflowStep } from './types.js';
import { parseJsonReply } from './ai.js';
import type { AskFn } from './ai.js';
import type { Thought } from './assist-ai.js';
import type { Proposal } from './proposal.js';
import type { Knowledge } from './cross-reference.js';
import { boxCenter } from './element-map-studio.js';
import { findFamiliar } from './coords.js';
import { habitKey, isReliable } from './habits.js';
import { similarity, uid } from './planner.js';

/** The user's limits on what aggressive mode may apply without asking. */
export interface AutoApplyBounds {
  /** Off: every aggressive candidate waits for the user's Apply. */
  enabled: boolean;
  /** Least AI confidence (0..1) an auto-applied candidate needs. */
  minConfidence: number;
  /** Farthest (normalised screen distance) the grounded point may sit from the planned one. */
  maxShift: number;
  /** Most candidates auto-applied per plan. */
  maxPerRun: number;
}

/** Conservative bounds: auto-apply off, and strict limits once it is turned on. */
export const DEFAULT_AUTO_APPLY: AutoApplyBounds = { enabled: false, minConfidence: 0.8, maxShift: 0.05, maxPerRun: 5 };

/** Upper limit of `maxShift` (half the screen). */
export const MAX_SHIFT_LIMIT = 0.5;

type Json = Record<string, unknown>;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const inRange = (v: unknown, min: number, max: number): v is number => isNum(v) && v >= min && v <= max;

/** Stored bounds field by field; an invalid field takes its default, never an unlimited value. */
export function sanitizeAutoApply(raw: unknown): AutoApplyBounds {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Json;
  const d = DEFAULT_AUTO_APPLY;
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    minConfidence: inRange(r.minConfidence, 0, 1) ? r.minConfidence : d.minConfidence,
    maxShift: inRange(r.maxShift, 0, MAX_SHIFT_LIMIT) ? r.maxShift : d.maxShift,
    maxPerRun: Number.isInteger(r.maxPerRun) && (r.maxPerRun as number) >= 1 ? (r.maxPerRun as number) : d.maxPerRun,
  };
}

/** The best known point for a target, and which memory it came from. */
export interface KnownGrounding {
  x: number;
  y: number;
  source: 'mapped' | 'familiar' | 'habit';
  name: string;
}

/** A mapped element whose every word is in the target (\"Files\" grounds \"Files icon\"), the most specific first. */
function mappedGrounding(target: string, k: Knowledge): KnownGrounding | null {
  const hits = k.map.filter((e) => similarity(e.name, target) === 1).sort((a, b) => b.name.length - a.name.length);
  return hits[0] ? { ...boxCenter(hits[0].box), source: 'mapped', name: hits[0].name } : null;
}

function familiarGrounding(target: string, k: Knowledge): KnownGrounding | null {
  const f = findFamiliar(k.familiar, target);
  return f ? { x: f.x, y: f.y, source: 'familiar', name: f.name } : null;
}

function habitGrounding(target: string, k: Knowledge): KnownGrounding | null {
  const h = k.habits.find((x) => x.anchor && isReliable(x) && habitKey(x.target, x.context) === habitKey(target, k.context));
  return h?.anchor ? { x: h.anchor.x, y: h.anchor.y, source: 'habit', name: h.target } : null;
}

const GROUNDERS = [mappedGrounding, familiarGrounding, habitGrounding];

/** The best grounding the assistant already has for `target`: a mapped boundary, then a familiar point, then a reliable habit anchor. */
export function bestGrounding(target: string, k: Knowledge): KnownGrounding | null {
  for (const ground of GROUNDERS) {
    const g = ground(target, k);
    if (g) return g;
  }
  return null;
}

/** Normalised distance between the grounded point and the step's planned point. */
export const groundingShift = (step: WorkflowStep, g: KnownGrounding) => Math.hypot(g.x - (step.correctedX ?? step.x), g.y - (step.correctedY ?? step.y));

/** `step` aimed at the grounded point (its stale template and correction dropped). */
export const groundedStep = (step: WorkflowStep, g: KnownGrounding): WorkflowStep => ({ ...step, x: g.x, y: g.y, correctedX: undefined, correctedY: undefined, refFrame: undefined });

/** Goal verbs aggressive mode turns into one grounded step without the planner. */
const GOAL_VERBS: Array<[RegExp, StepAction]> = [
  [/^double[- ]?click\s+(?:on\s+)?(?:the\s+)?(.+)$/i, 'double_click'],
  [/^click\s+(?:on\s+)?(?:the\s+)?(.+)$/i, 'click'],
  [/^(?:move|hover)\s+(?:the\s+)?(?:mouse\s+|cursor\s+)?(?:to|over|onto)\s+(?:the\s+)?(.+)$/i, 'move'],
];

/** A one-step plan for a goal that names a pointer action on a known element; null when the planner is needed. */
export function groundGoal(goal: string, k: Knowledge): WorkflowStep | null {
  const text = goal.trim();
  for (const [re, action] of GOAL_VERBS) {
    const m = re.exec(text);
    const g = m ? bestGrounding(m[1].trim(), k) : null;
    if (m && g) return { id: uid('step'), name: text, action, target: m[1].trim(), x: g.x, y: g.y, status: 'pending' };
  }
  return null;
}

/** The AI's judgment of an aggressive candidate. */
export interface Judgment extends Thought {
  fair: boolean;
  inScope: boolean;
  confidence: number;
  reason: string;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** System prompt of the aggressive-mode judge. */
export const JUDGE_SYSTEM = `You are Droid Assist's judge for aggressive mode. A step was grounded at once on remembered coordinates, without planning. Look at the screenshot and judge it.
Reply ONLY with JSON {"fair":boolean,"inScope":boolean,"confidence":number,"reason":string}.
fair = the point really is the named target on this screen and acting there is safe; inScope = the step serves the user's goal and nothing beyond it; confidence 0..1.`;

/**
 * Sends a grounded candidate to the AI for one judgment. A reply without a usable verdict is judged
 * unfair with confidence 0, so it is never auto-applied.
 */
export async function judgeCandidate(ask: AskFn, frame: Frame | null, step: WorkflowStep, g: KnownGrounding, goal: string): Promise<Judgment> {
  const { content, thinking } = await ask({
    system: JUDGE_SYSTEM,
    prompt: `Goal: ${goal || '(none)'}\nStep: ${step.action} "${step.target ?? step.name}"${step.text ? ` with "${step.text}"` : ''} at (${pct(g.x)}, ${pct(g.y)}), grounded on the ${g.source} element "${g.name}".`,
    frame,
    json: true,
  });
  const r = parseJsonReply(content);
  const confidence = isNum(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
  return { fair: r.fair === true, inScope: r.inScope === true, confidence, reason: typeof r.reason === 'string' ? r.reason : '', thinking };
}

/** Whether a judged candidate is applied now or held for the user, and why. */
export interface ApplyDecision {
  apply: boolean;
  reason: string;
}

/** An aggressive candidate held for the user's Apply. */
export interface HeldCandidate {
  id: string;
  time: number;
  /** The workflow step it would run. */
  stepId: string;
  /** The step aimed at the grounded point, as it would dispatch. */
  step: WorkflowStep;
  proposal: Proposal;
  /** Why it was not auto-applied. */
  reason: string;
}

/** Timeline text of a judgment. */
export const judgmentText = (j: Judgment) => `${j.fair ? 'Fair' : 'Not fair'}, ${j.inScope ? 'in scope' : 'out of scope'}, confidence ${j.confidence.toFixed(2)}${j.reason ? ` — ${j.reason}` : ''}`;

/** Each bound in the order it is checked: the first that fails holds the candidate. */
const BOUND_CHECKS: Array<(j: Judgment, shift: number, applied: number, b: AutoApplyBounds) => string | null> = [
  (_j, _s, _a, b) => (b.enabled ? null : 'auto-apply is off'),
  (j) => (j.fair ? null : 'the AI did not judge it fair'),
  (j) => (j.inScope ? null : 'the AI judged it out of scope'),
  (j, _s, _a, b) => (j.confidence >= b.minConfidence ? null : `AI confidence ${j.confidence.toFixed(2)} is below ${b.minConfidence.toFixed(2)}`),
  (_j, s, _a, b) => (s <= b.maxShift ? null : `the grounded point is ${pct(s)} from the plan, beyond ${pct(b.maxShift)}`),
  (_j, _s, a, b) => (a < b.maxPerRun ? null : `${b.maxPerRun} auto-apply(s) already used this run`),
];

/** Auto-applies a judged candidate only inside every bound; otherwise holds it with the first failing bound. */
export function autoApplyDecision(j: Judgment, shift: number, applied: number, bounds: AutoApplyBounds): ApplyDecision {
  for (const check of BOUND_CHECKS) {
    const why = check(j, shift, applied, bounds);
    if (why) return { apply: false, reason: `held for your Apply — ${why}` };
  }
  return { apply: true, reason: `auto-applied — fair, in scope, confidence ${j.confidence.toFixed(2)}, ${pct(shift)} from the plan` };
}
