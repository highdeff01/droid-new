/**
 * Agent cadence: every agent reports its current activity on its own period (5 s by default,
 * 10 s for the role-paced reviewers), gated by its loop-control checkbox and slowed in relaxation mode.
 */
import type { StageId, StageMap } from './loop-control.js';
import { CREW_AGENTS } from './agent-crew.js';
import { OPS_AGENTS, type OpsAgentId } from './operations.js';
import { relaxInterval } from './relax.js';
import { isPopupLine } from './attention.js';

/** Default reporting period. */
export const CADENCE_MS = 5000;
/** Period of the agents whose role is to review over longer spans (goal reviewer, supervisor). */
export const REVIEW_CADENCE_MS = 10_000;
/** How often the engine checks which agents are due. */
export const CADENCE_TICK_MS = 1000;
/** Most reports kept, newest first. */
export const REPORT_LIMIT = 200;

/** What a reporter reads to describe an agent's activity: its role kind, plus the crew/ops agent it is. */
export type CadenceKind = 'popup' | 'drift' | 'progress' | 'goal' | 'screenWatcher' | 'coords' | 'supervisor' | 'crew' | 'ops';

/** One agent on the cadence. */
export interface CadenceAgent {
  id: string;
  kind: CadenceKind;
  stage: StageId;
  name: string;
  periodMs: number;
  /** The crew agent id or Operations agent id it stands for. */
  ref?: string;
}

/** One live report of what an agent is doing now. */
export interface AgentReport {
  agent: string;
  name: string;
  stage: StageId;
  time: number;
  text: string;
}

const solo = (kind: Exclude<CadenceKind, 'crew' | 'ops'>, name: string, periodMs = CADENCE_MS): CadenceAgent => ({ id: kind, kind, stage: kind, name, periodMs });

/** Every agent that reports on the cadence, in panel order. */
export const CADENCE_AGENTS: readonly CadenceAgent[] = [
  solo('popup', 'Popup watcher'),
  solo('drift', 'Drift monitor'),
  solo('progress', 'Progress tracker'),
  solo('goal', 'Goal reviewer', REVIEW_CADENCE_MS),
  solo('screenWatcher', 'Screen watcher'),
  solo('coords', 'Coordinate learner'),
  solo('supervisor', 'Supervisor', REVIEW_CADENCE_MS),
  ...CREW_AGENTS.map((ref): CadenceAgent => ({ id: `crew:${ref}`, kind: 'crew', stage: 'crew', name: `Crew ${ref}`, periodMs: CADENCE_MS, ref })),
  ...OPS_AGENTS.map((a): CadenceAgent => ({ id: `ops:${a.id}`, kind: 'ops', stage: a.stage, name: a.name, periodMs: CADENCE_MS, ref: a.id satisfies OpsAgentId })),
];

/**
 * The agents due to report at `now`: checked in loop control and at least one (relaxed) period
 * past their last report; an agent that never reported is due at once.
 */
export function dueAgents(stages: StageMap, lastAt: Readonly<Record<string, number>>, now: number, relax: boolean): CadenceAgent[] {
  return CADENCE_AGENTS.filter((a) => stages[a.stage] && now - (lastAt[a.id] ?? -Infinity) >= relaxInterval(a.periodMs, relax));
}

/** New reports first, capped at REPORT_LIMIT. */
export const addReports = (list: AgentReport[], reports: AgentReport[]): AgentReport[] => [...reports, ...list].slice(0, REPORT_LIMIT);

/** The newest report of every agent, newest first. */
export function latestReports(list: AgentReport[]): AgentReport[] {
  const seen = new Set<string>();
  return list.filter((r) => !seen.has(r.agent) && seen.add(r.agent));
}

/** The agents' findings as AI context lines: the newest per agent, popup findings quarantined out. */
export const reportContext = (list: AgentReport[]): string[] =>
  latestReports(list).map((r) => `[${r.name}] ${r.text}`).filter((l) => !isPopupLine(l));
