import { SAMPLE_VIEW, parseJsonReply, toUnit } from './ai.js';
import type { AskFn, AskRequest, ViewSize } from './ai.js';
import type { Thought } from './assist-ai.js';

/**
 * What the AI decides after a wake: apply the planned step now, reroute (re-plan the rest),
 * stop, try an alternate method, keep waiting for a set time, start a new workflow in place of
 * the current one, or start a parallel context workflow alongside it.
 */
export type DecisionKind = 'apply' | 'reroute' | 'stop' | 'alternate' | 'wait' | 'new' | 'parallel';
export const DECISION_KINDS: readonly DecisionKind[] = ['apply', 'reroute', 'stop', 'alternate', 'wait', 'new', 'parallel'];

/** Something a parallel context workflow tracks on the screen: its name and normalized position. */
export interface TrackedPoint {
  name: string;
  x: number;
  y: number;
}

/** What a parallel decision starts: keep `subject` within `maxDistance` (fraction of screen width) of `anchor`. */
export interface ParallelSpec {
  goal: string;
  subject: TrackedPoint;
  anchor: TrackedPoint;
  maxDistance: number;
}

/** The AI's decision after a wake. */
export interface WakeDecision extends Thought {
  kind: DecisionKind;
  reason: string;
  /** wait: how long to keep waiting, in ms. */
  waitMs?: number;
  /** alternate: the other method to use. */
  method?: string;
  /** new: the goal of the fresh workflow. */
  goal?: string;
  /** parallel: the context workflow to start. */
  parallel?: ParallelSpec;
}

/** The handler of each decision kind. */
export type DecisionHandlers<R> = Record<DecisionKind, (d: WakeDecision) => R>;

/** Default (and fallback) distance limit of a parallel workflow: a fifth of the screen width. */
export const DEFAULT_MAX_DISTANCE = 0.2;

/** System prompt of the wake decision for a `view`-sized screenshot. */
export const decisionSystem = (view: ViewSize) => `You are Droid Assist's executor, woken up while waiting during an operation. You do NOT act yet: compare the screen before the wait with the fresh screen, factor in what changed, and decide what to do next. Coordinates are fractions 0..1 of the screenshot (${view.w}x${view.h}) width/height.
Reply ONLY with JSON {"decision":"apply"|"reroute"|"stop"|"alternate"|"wait"|"new"|"parallel","reason":string,"waitMs":number,"method":string,"goal":string,"subject":{"name":string,"x":number,"y":number},"anchor":{"name":string,"x":number,"y":number},"maxDistance":number}.
apply = the awaited thing is ready, run the planned step now; reroute = the plan no longer fits, re-plan the remaining steps; stop = stop the operation; alternate = reach the goal with a different method (give "method"); wait = keep waiting (give "waitMs", your estimate); new = replace the workflow with a new one (give "goal"); parallel = start a parallel context workflow alongside it that keeps "subject" within "maxDistance" (fraction of screen width) of "anchor" (give "goal", "subject", "anchor").`;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const positive = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/** A tracked point from the reply, or null when it has no name or no valid point. */
function trackedOf(raw: unknown, view: ViewSize): TrackedPoint | null {
  const p = (raw ?? {}) as Record<string, unknown>;
  const name = str(p.name);
  if (!name) return null;
  try {
    return { name, x: toUnit(p.x, view.w), y: toUnit(p.y, view.h) };
  } catch {
    return null;
  }
}

/** The parallel spec of a reply, or null when its subject or anchor is missing. */
function parallelOf(r: Record<string, unknown>, view: ViewSize): ParallelSpec | null {
  const subject = trackedOf(r.subject, view);
  const anchor = trackedOf(r.anchor, view);
  if (!subject || !anchor) return null;
  const limit = positive(r.maxDistance);
  return { goal: str(r.goal) || `keep ${subject.name} close to ${anchor.name}`, subject, anchor, maxDistance: limit && limit <= 1 ? limit : DEFAULT_MAX_DISTANCE };
}

/** A stop decision carrying why the reply could not be followed. */
const stopBecause = (reason: string, thinking: string | null): WakeDecision => ({ kind: 'stop', reason, thinking });

/**
 * Reads a decision reply. An unknown kind, or a kind missing what it needs (new without a goal,
 * parallel without subject/anchor), is read as stop; a reply without JSON throws AiParseError.
 */
export function parseDecision(content: string, thinking: string | null = null, view: ViewSize = SAMPLE_VIEW): WakeDecision {
  const r = parseJsonReply(content);
  const kind = str(r.decision) as DecisionKind;
  const reason = str(r.reason) || '(no reason given)';
  if (!DECISION_KINDS.includes(kind)) return stopBecause(`unknown decision "${str(r.decision)}" — stopped: ${reason}`, thinking);
  const base: WakeDecision = { kind, reason, thinking };
  if (kind === 'wait') return { ...base, waitMs: positive(r.waitMs) };
  if (kind === 'alternate') return { ...base, method: str(r.method) || reason };
  if (kind === 'new') return str(r.goal) ? { ...base, goal: str(r.goal) } : stopBecause(`"new" without a goal — stopped: ${reason}`, thinking);
  if (kind !== 'parallel') return base;
  const parallel = parallelOf(r, view);
  return parallel ? { ...base, parallel } : stopBecause(`"parallel" without a subject and anchor — stopped: ${reason}`, thinking);
}

/** Asks the model for its wake decision. */
export async function askDecision(ask: AskFn, req: AskRequest): Promise<WakeDecision> {
  const { content, thinking, view = SAMPLE_VIEW } = await ask(req);
  return parseDecision(content, thinking, view);
}

/** Runs the handler of the decision's kind. */
export const dispatchDecision = <R>(d: WakeDecision, handlers: DecisionHandlers<R>): R => handlers[d.kind](d);

/** One-line text of a decision, for the log, notes and timeline. */
export function decisionText(d: WakeDecision): string {
  const extra = d.kind === 'wait' && d.waitMs ? ` ${Math.round(d.waitMs / 1000)} s` : d.kind === 'alternate' ? `: ${d.method}` : d.kind === 'new' ? `: "${d.goal}"` : d.kind === 'parallel' ? `: ${d.parallel!.goal}` : '';
  return `${d.kind.toUpperCase()}${extra} — ${d.reason}`;
}
