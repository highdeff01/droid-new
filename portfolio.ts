import { uid } from './planner.js';

/**
 * Per-actor portfolios: every agent and every AI (the main model plus any connected model) keeps
 * its own timestamped notes, learned methods, assigned work and results, each referencing the
 * operation it came from, so knowledge stays attributable and queryable per actor.
 */

/** What a portfolio entry records. */
export type PortfolioKind = 'note' | 'method' | 'work' | 'result';
export const PORTFOLIO_KINDS: readonly PortfolioKind[] = ['note', 'method', 'work', 'result'];

/** The operation an entry came from: its goal text and the plan id it ran under (null outside a plan). */
export interface PortfolioSource {
  operation: string;
  opId: string | null;
}

export interface PortfolioEntry {
  id: string;
  /** Agent id, performer name, or `ai:<model>` for an AI. */
  actor: string;
  kind: PortfolioKind;
  text: string;
  time: number;
  source: PortfolioSource;
  /** Set on a result: whether it succeeded. */
  ok?: boolean;
}

/** Most entries kept across every portfolio (newest first). */
export const PORTFOLIO_LIMIT = 500;

const AI_PREFIX = 'ai:';

/** The actor id of the AI answering with `model`. */
export const aiActor = (model: string) => `${AI_PREFIX}${model}`;
export const isAiActor = (actor: string) => actor.startsWith(AI_PREFIX);

/** A readable name: the agent's name, `AI · <model>` (marked main when it is the configured model), or the id itself. */
export function actorLabel(actor: string, agentNames: Readonly<Record<string, string>>, mainModel: string): string {
  if (!isAiActor(actor)) return agentNames[actor] ?? actor;
  const model = actor.slice(AI_PREFIX.length);
  return `AI · ${model}${model === mainModel ? ' (main)' : ' (connected)'}`;
}

/** Adds one entry to `actor`'s portfolio, newest first, capped at PORTFOLIO_LIMIT. */
export function addPortfolioEntry(list: PortfolioEntry[], entry: Omit<PortfolioEntry, 'id' | 'time'>, time = Date.now()): PortfolioEntry[] {
  return [{ ...entry, id: uid('pf'), time }, ...list].slice(0, PORTFOLIO_LIMIT);
}

/** What a portfolio query may filter on; every field is optional. */
export interface PortfolioQuery {
  actor?: string;
  kind?: PortfolioKind;
  operation?: string;
}

/** The entries matching every given filter, newest first. */
export const queryPortfolio = (list: PortfolioEntry[], q: PortfolioQuery): PortfolioEntry[] =>
  list.filter((e) => (q.actor === undefined || e.actor === q.actor) && (q.kind === undefined || e.kind === q.kind) && (q.operation === undefined || e.source.operation === q.operation));

/** Every actor that has a portfolio, in order of first appearance (newest activity first). */
export const portfolioActors = (list: PortfolioEntry[]): string[] => [...new Set(list.map((e) => e.actor))];

const isStr = (v: unknown): v is string => typeof v === 'string';

/** True for a stored entry with every required field. */
export function isPortfolioEntry(v: unknown): v is PortfolioEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  const s = e.source as Record<string, unknown> | undefined;
  return isStr(e.id) && isStr(e.actor) && isStr(e.text) && typeof e.time === 'number' && PORTFOLIO_KINDS.includes(e.kind as PortfolioKind)
    && !!s && typeof s === 'object' && isStr(s.operation) && (s.opId === null || isStr(s.opId)) && (e.ok === undefined || typeof e.ok === 'boolean');
}
