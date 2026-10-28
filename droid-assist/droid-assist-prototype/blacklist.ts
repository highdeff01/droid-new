/**
 * The structured blacklist: the only avoid entries that may block a dispatch. Each rule is scoped to
 * one action on one named target near one point (pointer actions), learned from fresh on-screen
 * failures, and expires on its own. Prose lessons (reflect verdicts, run reviews) never land here —
 * they are advisory planning context only.
 */
import type { StepAction, WorkflowStep } from './types.js';
import { POINTER_ACTIONS } from './types.js';
import { similarity, uid } from './planner.js';

type Point = { x: number; y: number };

/** Where a rule was learned: a step's retry ladder (habit), a background test, or a popup/overlay dismissal. */
export type AvoidSource = 'habit' | 'test' | 'dismissal';

/** One dispatch-blocking avoid rule: action + target + point vicinity, with its strikes and expiry. */
export interface AvoidRule {
  id: string;
  action: StepAction;
  /** The target name as the step names it. */
  target: string;
  /** The blocked point (normalised); null for a non-pointer action (the action on the target anywhere). */
  x: number | null;
  y: number | null;
  source: AvoidSource;
  /** The single decisive failure message. */
  reason: string;
  /** Fresh failures counted since the rule was first seen (reset when it lapses). */
  strikes: number;
  firstAt: number;
  lastAt: number;
  /** When the rule stops existing: the TTL once blocking, the re-learn window while pending, the cooldown for a dismissal. */
  expiresAt: number;
}

/** Default lifetime of a blocking rule, hours (the `avoidTtlHours` setting). */
export const DEFAULT_AVOID_TTL_HOURS = 24;
export const AVOID_TTL_HOURS_MIN = 1;
export const AVOID_TTL_HOURS_MAX = 168;
/** Fresh failures a (non-dismissal) rule needs before it blocks. */
export const RELEARN_STRIKES = 2;
/** How long a pending strike stays fresh, ms: a second failure later than this starts over. */
export const RELEARN_WINDOW_MS = 60 * 60 * 1000;
/** The short cooldown a failed popup/overlay dismissal gets instead of a blacklist entry, ms. */
export const DISMISS_COOLDOWN_MS = 2 * 60 * 1000;
/** A rule covers points within this normalised distance of its own (3% of the screen). */
export const AVOID_RADIUS = 0.03;
/** Most rules kept. */
export const AVOID_RULE_LIMIT = 100;

const HOUR_MS = 60 * 60 * 1000;
/** The TTL in ms for a setting in hours (clamped to its range). */
export const ttlMs = (hours: number) => Math.min(AVOID_TTL_HOURS_MAX, Math.max(AVOID_TTL_HOURS_MIN, Number.isFinite(hours) ? hours : DEFAULT_AVOID_TTL_HOURS)) * HOUR_MS;

/** Words that make a step a popup/overlay dismissal. */
const DISMISS_WORDS = /\b(popup|pop-up|overlay|modal|dialog|banner|offer|ad|advert|dismiss|close|cancel|skip|no thanks|got it|later)\b|[×✕✖]/i;
/** Whether `step` dismisses a popup/overlay: its target or name says so. */
export const isDismissal = (step: Pick<WorkflowStep, 'name' | 'target'>) => DISMISS_WORDS.test(`${step.target ?? ''} ${step.name}`);

const BLOCK_CHAIN = /^.*\b(?:not dispatched|blocked|blacklisted|learned avoid|habit avoid|test avoid|dismissal cooldown)\s*(?:—|-|:)\s*/i;
/**
 * The single decisive message of a failure text: any nested block prefixes ("not dispatched —
 * blacklisted — Learned avoid: …") and a trailing "— not executed" are cut, so no reason chains.
 */
export const decisiveReason = (text: string) => text.replace(BLOCK_CHAIN, '').replace(/\s*—\s*not executed\.?$/i, '').trim();

/** Whether an outcome message is itself a dispatch block (nothing ran on screen, so nothing to learn). */
export const isBlockOutcome = (message: string) => /\b(not dispatched|blocked — |blacklisted)\b/i.test(message);

const fold = (s: string) => s.toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ').trim();
/** The same target: equal names, case/quote/space-insensitive (never a shared word, so "Click 1" ≠ "Click 6"). */
const sameTarget = (a: string, b: string) => fold(a) === fold(b);
const targetOf = (s: Pick<WorkflowStep, 'name' | 'target'>) => s.target ?? s.name;
const pointOf = (s: WorkflowStep): Point | null => (POINTER_ACTIONS.has(s.action) ? { x: s.correctedX ?? s.x, y: s.correctedY ?? s.y } : null);
const near = (r: AvoidRule, p: Point | null) => (r.x === null || r.y === null || !p ? r.x === null && !p : Math.hypot(r.x - p.x, r.y - p.y) <= AVOID_RADIUS);

/** Rules still alive at `now`. */
export const pruneRules = (rules: AvoidRule[], now = Date.now()) => rules.filter((r) => r.expiresAt > now);

/** Whether a live rule blocks: a dismissal cooldown always, any other once it has RELEARN_STRIKES fresh failures. */
export const isBlocking = (r: AvoidRule, now = Date.now()) => r.expiresAt > now && (r.source === 'dismissal' || r.strikes >= RELEARN_STRIKES);

/** Whether `r` is about this step: same action, same target, and (pointer actions) its point within AVOID_RADIUS. */
const scopeOf = (r: AvoidRule, step: WorkflowStep) => r.action === step.action && sameTarget(r.target, targetOf(step)) && near(r, pointOf(step));

/** The blocking rule for `step` at `now`, or null. */
export const blockingRule = (rules: AvoidRule[], step: WorkflowStep, now = Date.now()) => rules.find((r) => isBlocking(r, now) && scopeOf(r, step)) ?? null;

/** One fresh on-screen failure of a step. */
export interface FailureEvent {
  step: WorkflowStep;
  message: string;
  source: Exclude<AvoidSource, 'dismissal'>;
  ttl: number;
  now?: number;
  /** The flagged popup/overlay box, when one is shown: a click inside it is a dismissal. */
  obstacle?: ObstacleBox;
}

/** When a rule with these strikes expires: dismissal cooldown, the TTL once blocking, else the re-learn window. */
function expiryOf(source: AvoidSource, strikes: number, now: number, ttl: number) {
  if (source === 'dismissal') return now + DISMISS_COOLDOWN_MS;
  return now + (strikes >= RELEARN_STRIKES ? ttl : RELEARN_WINDOW_MS);
}

/**
 * Records one fresh failure: strikes the live rule for this step's scope (or starts one) and sets its
 * expiry. A popup/overlay dismissal only ever gets a DISMISS_COOLDOWN_MS cooldown, never the TTL.
 * A block outcome is not a failure and changes nothing.
 */
export function recordFailure(rules: AvoidRule[], e: FailureEvent): AvoidRule[] {
  const now = e.now ?? Date.now();
  if (isBlockOutcome(e.message) || !targetOf(e.step).trim()) return rules;
  const live = pruneRules(rules, now);
  const found = live.find((r) => scopeOf(r, e.step));
  const p = pointOf(e.step);
  const source: AvoidSource = isDismissal(e.step) || insideBox(e.obstacle, p?.x ?? null, p?.y ?? null) ? 'dismissal' : e.source;
  // One failure event (a whole retry ladder or test) is one strike, however many attempts it made.
  const strikes = (found?.strikes ?? 0) + 1;
  const rule: AvoidRule = {
    id: found?.id ?? uid('avoid'), action: e.step.action, target: targetOf(e.step).trim(), x: p?.x ?? null, y: p?.y ?? null,
    source, reason: decisiveReason(e.message), strikes, firstAt: found?.firstAt ?? now, lastAt: now, expiresAt: expiryOf(source, strikes, now, e.ttl),
  };
  return [rule, ...live.filter((r) => r !== found)].slice(0, AVOID_RULE_LIMIT);
}

const related = (a: string, b: string) => similarity(a, b) > 0 || similarity(b, a) > 0;

/** A flagged popup/overlay box, normalised like step points. */
export interface ObstacleBox { x: number; y: number; w: number; h: number }
const insideBox = (b: ObstacleBox | undefined, x: number | null, y: number | null) =>
  !!b && x !== null && y !== null && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

/** Whether `r` is about the obstacle: a dismissal cooldown, or a rule whose point lies inside the flagged box. */
const onObstacle = (r: AvoidRule, box?: ObstacleBox) => r.source === 'dismissal' || insideBox(box, r.x, r.y);

/**
 * The deadlock check of a blocked step: with a blocking obstacle detected on screen (the popup
 * watcher's flag) every blocking rule for that obstacle (dismissal cooldowns and any rule whose point
 * lies inside its box) is returned to clear — for a step that dismisses it, the rules of the same or
 * a related target or inside the box; for a step the obstacle covers, every such rule. Empty when no
 * obstacle is detected or nothing of its dismissal is blacklisted.
 */
export function deadlockRules(rules: AvoidRule[], step: WorkflowStep, obstacleShown: boolean, now = Date.now(), box?: ObstacleBox): AvoidRule[] {
  if (!obstacleShown) return [];
  const dismissing = isDismissal(step);
  const target = targetOf(step);
  return rules.filter((r) => onObstacle(r, box) && isBlocking(r, now)
    && (!dismissing || insideBox(box, r.x, r.y) || sameTarget(r.target, target) || related(r.target, target)));
}

/** `rules` without the given ones. */
export const withoutRules = (rules: AvoidRule[], gone: AvoidRule[]) => rules.filter((r) => !gone.some((g) => g.id === r.id));

const SOURCE_LABEL: Record<AvoidSource, string> = { habit: 'Habit avoid', test: 'Test avoid', dismissal: 'Dismissal cooldown' };
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** A rule's scope: `action "target" near (x%, y%)`, or `action "target"` for a non-pointer action. */
export const ruleScope = (r: AvoidRule) => `${r.action} "${r.target}"${r.x !== null && r.y !== null ? ` near (${pct(r.x)}, ${pct(r.y)})` : ''}`;

/** The single decisive block reason of a rule: `blacklisted — <source>: <scope> — <reason>`. */
export const ruleReason = (r: AvoidRule) => `blacklisted — ${SOURCE_LABEL[r.source]}: ${ruleScope(r)} — ${r.reason}`;

/** A rule as one line (panel, capability list, planner): id, scope, source, status and expiry. */
export function ruleLine(r: AvoidRule, now = Date.now()): string {
  const state = isBlocking(r, now) ? 'blocking' : `pending ${r.strikes}/${RELEARN_STRIKES} failures`;
  return `${r.id}: ${SOURCE_LABEL[r.source]} ${ruleScope(r)} (${state}, expires in ${durationText(r.expiresAt - now)}) — ${r.reason}`;
}

/** A duration as the largest whole unit: "3 h", "12 min", "40 s". */
export function durationText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s >= 3600) return `${Math.round(s / 3600)} h`;
  if (s >= 60) return `${Math.round(s / 60)} min`;
  return `${s} s`;
}

/** A valid stored rule, or null. */
export function isAvoidRule(v: unknown): v is AvoidRule {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  const num = (k: string) => typeof r[k] === 'number' && Number.isFinite(r[k]);
  const coord = (k: string) => r[k] === null || num(k);
  return typeof r.id === 'string' && typeof r.action === 'string' && typeof r.target === 'string' && !!r.target.trim()
    && ['habit', 'test', 'dismissal'].includes(r.source as string) && typeof r.reason === 'string'
    && coord('x') && coord('y') && num('strikes') && num('firstAt') && num('lastAt') && num('expiresAt');
}
