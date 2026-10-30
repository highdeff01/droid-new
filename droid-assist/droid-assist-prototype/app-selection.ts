/**
 * App selection for the joint connection: for every operation droid-new (the arbiter) decides which
 * app calculates it and which performs it — one app, split across both, or both — from the capability
 * registry, the cost (AI calls, latency), the current load and what worked before. Both apps hold
 * admin status; the decision and its reasoning are logged.
 */
import { JOINT_APPS, type JointApp } from './main-bridge-protocol.js';

/** The arbiter of every joint decision. */
export const ARBITER: JointApp = 'droid-new';
/** Cost of one AI call in latency-equivalent milliseconds. */
export const AI_CALL_COST = 1000;
/** Cost of a fully loaded app (load 1) in latency-equivalent milliseconds. */
export const LOAD_COST = 500;
/** Cost removed per remembered success (and added per failure) of the operation on an app. */
export const MEMORY_CREDIT = 200;

/** What one app offers right now. */
export interface AppProfile {
  app: JointApp;
  connected: boolean;
  /** Capability ids it can take on. */
  capabilities: readonly string[];
  /** Current load, 0..1. */
  load: number;
  /** AI calls one operation costs there. */
  aiCalls: number;
  /** Round-trip latency to reach it (ms). */
  latencyMs: number;
}

/** One operation to place. */
export interface JointOperation {
  name: string;
  /** The capability id it needs. */
  capability: string;
  /** The app whose screen the operation acts on. */
  target: JointApp;
  /** The result must be verified against the other app's state as well. */
  crossApp: boolean;
}

/** How often the operation worked or failed on each app before. */
export type AppTally = Record<JointApp, { ok: number; failed: number }>;

/** single: one app does both halves; split: one calculates, the other performs; both: split plus cross-app verification. */
export type JointMode = 'single' | 'split' | 'both';

export interface AppDecision {
  operation: string;
  calculate: JointApp;
  perform: JointApp;
  mode: JointMode;
  reason: string;
}

export type Selection = { ok: true; decision: AppDecision } | { ok: false; reason: string };

/** A tally with nothing remembered. */
export const emptyTally = (): AppTally => ({ 'droid-new': { ok: 0, failed: 0 }, 'droid-main': { ok: 0, failed: 0 } });

/** Latency-equivalent cost of doing the operation on `p`, credited by what worked there before. */
export function appCost(p: AppProfile, memory: AppTally): number {
  const past = memory[p.app];
  return p.aiCalls * AI_CALL_COST + p.latencyMs + p.load * LOAD_COST + (past.failed - past.ok) * MEMORY_CREDIT;
}

/** Why `p` cannot take the operation, or null when it can. */
const unfit = (p: AppProfile, op: JointOperation): string | null => {
  if (!p.connected) return `${p.app} is not connected`;
  return p.capabilities.includes(op.capability) ? null : `${p.app} lacks "${op.capability}"`;
};

/** The cheapest fit app; a tie goes to the arbiter. */
function cheapest(fit: AppProfile[], memory: AppTally): AppProfile {
  return [...fit].sort((a, b) => appCost(a, memory) - appCost(b, memory) || Number(b.app === ARBITER) - Number(a.app === ARBITER))[0];
}

const costText = (p: AppProfile, memory: AppTally) => `${p.app} ${Math.round(appCost(p, memory))} (${p.aiCalls} AI call(s), ${Math.round(p.latencyMs)}ms, load ${Math.round(p.load * 100)}%, ${memory[p.app].ok}✓/${memory[p.app].failed}✗)`;

const modeOf = (op: JointOperation, calculate: JointApp, perform: JointApp): JointMode => (op.crossApp ? 'both' : calculate === perform ? 'single' : 'split');

/**
 * Places the operation: the cheapest fit app calculates; the target app performs when it is fit,
 * else the cheapest fit app does. Refused when no connected app has the capability.
 */
export function selectApps(op: JointOperation, profiles: readonly AppProfile[], memory: AppTally = emptyTally()): Selection {
  const known = JOINT_APPS.map((app) => profiles.find((p) => p.app === app)).filter((p): p is AppProfile => !!p);
  const fit = known.filter((p) => !unfit(p, op));
  if (!fit.length) return { ok: false, reason: `No app can do "${op.name}" — ${known.map((p) => unfit(p, op)).join('; ') || 'no app profiles'}` };
  const calc = cheapest(fit, memory);
  const perform = fit.find((p) => p.app === op.target) ?? calc;
  const mode = modeOf(op, calc.app, perform.app);
  const target = known.find((p) => p.app === op.target);
  const why = perform.app === op.target ? `${op.target} owns the target screen` : `${op.target} cannot — ${target ? unfit(target, op) : 'no profile'}`;
  const reason = `${ARBITER} arbitrates: ${calc.app} calculates (cheapest — ${fit.map((p) => costText(p, memory)).join(' vs ')}); ${perform.app} performs (${why})${mode === 'both' ? '; both verify the result' : ''}`;
  return { ok: true, decision: { operation: op.name, calculate: calc.app, perform: perform.app, mode, reason } };
}

/** One-line log text of a decision. */
export const decisionText = (d: AppDecision) => `"${d.operation}" → ${d.mode}: ${d.reason}`;
