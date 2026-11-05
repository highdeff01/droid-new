import { uid } from './planner.js';
import { sameElement, type ForwardedElement } from './agent-bus.js';
import type { StepAction, WorkflowStep } from './types.js';

/** What a crew worker does for the main AI. */
export type CrewRole = 'sentinel' | 'pathChecker' | 'adjuster' | 'tester' | 'monitor';

/** Display name, purpose and share of the crew of each role. */
export const CREW_ROLES: Readonly<Record<CrewRole, { name: string; description: string; share: number }>> = {
  sentinel: { name: 'Coordinate sentinel', description: 'Holds last-known coordinates of its elements and answers position queries instantly', share: 0.3 },
  pathChecker: { name: 'Path checker', description: 'Checks workflow progress against the plotted route and recommends retry / alternate / skip / adjust', share: 0.15 },
  adjuster: { name: 'Adjustment responder', description: 'Fast feedback on coordinate corrections, grounded in habits and position memory', share: 0.15 },
  tester: { name: 'Test runner', description: 'Runs background tests against captured frames, then the main-screen test', share: 0.2 },
  monitor: { name: 'Monitor', description: 'Watches surrounding areas, tabs, buttons and pages for element changes', share: 0.2 },
};

/** Every role, in panel order. */
export const CREW_ROLE_IDS = Object.keys(CREW_ROLES) as CrewRole[];

/** Valid crew sizes (matches the Settings slider) and the default. */
export const CREW_SIZE_MIN = 5;
export const CREW_SIZE_MAX = 50;
export const CREW_SIZE_DEFAULT = 25;

/** waiting: ready for the next command; working: on a task; paused: holding for an intercept. */
export type CrewStatus = 'waiting' | 'working' | 'paused';

/** One crew worker. */
export interface CrewAgent {
  id: string;
  role: CrewRole;
  status: CrewStatus;
  /** The command it is working on. */
  task?: string;
  /** What it last reported back to the main AI. */
  report?: string;
  /** A sentinel's quick-reference map: its elements' last-known centers (newest first). */
  elements: ForwardedElement[];
}

/** A crew size rounded and clamped into range; anything not a finite number is the default. */
export function clampCrewSize(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return CREW_SIZE_DEFAULT;
  return Math.min(CREW_SIZE_MAX, Math.max(CREW_SIZE_MIN, Math.round(v)));
}

/** Seats per role: one each, the rest split by share (largest remainder). */
export function roleCounts(size: number): Record<CrewRole, number> {
  const total = clampCrewSize(size);
  const spare = total - CREW_ROLE_IDS.length;
  const exact = CREW_ROLE_IDS.map((r) => spare * CREW_ROLES[r].share);
  const counts = exact.map((e) => 1 + Math.floor(e));
  let left = total - counts.reduce((a, b) => a + b, 0);
  const byRemainder = CREW_ROLE_IDS.map((_, i) => i).sort((a, b) => (exact[b] % 1) - (exact[a] % 1));
  for (const i of byRemainder) if (left-- > 0) counts[i] += 1;
  return Object.fromEntries(CREW_ROLE_IDS.map((r, i) => [r, counts[i]])) as Record<CrewRole, number>;
}

/** The crew for `size` seats; an agent already in `prev` with the same id keeps its state. */
export function buildCrew(size: number, prev: readonly CrewAgent[] = []): CrewAgent[] {
  const counts = roleCounts(size);
  return CREW_ROLE_IDS.flatMap((role) => Array.from({ length: counts[role] }, (_, i) => {
    const id = `${role}-${i + 1}`;
    return prev.find((a) => a.id === id) ?? { id, role, status: 'waiting' as const, elements: [] };
  }));
}

const update = (crew: readonly CrewAgent[], id: string, patch: (a: CrewAgent) => CrewAgent): CrewAgent[] => crew.map((a) => (a.id === id ? patch(a) : a));

/** The main AI assigns `task` to one agent. */
export const assign = (crew: readonly CrewAgent[], id: string, task: string): CrewAgent[] => update(crew, id, (a) => ({ ...a, status: 'working', task }));

/** The main AI moves one agent to another role (its sentinel map is kept only while it stays a sentinel). */
export const reassign = (crew: readonly CrewAgent[], id: string, role: CrewRole): CrewAgent[] =>
  update(crew, id, (a) => ({ ...a, role, elements: role === 'sentinel' ? a.elements : [] }));

/** The agent reports back and waits for the next command. */
export const reportBack = (crew: readonly CrewAgent[], id: string, report: string): CrewAgent[] =>
  update(crew, id, ({ task: _task, ...a }) => ({ ...a, status: 'waiting', report }));

/** The first waiting agent of `role`, else the first of that role; null when the role has no seats. */
export const pickAgent = (crew: readonly CrewAgent[], role: CrewRole): CrewAgent | null =>
  crew.find((a) => a.role === role && a.status === 'waiting') ?? crew.find((a) => a.role === role) ?? null;

/** The main AI commands `role`: one agent of it takes `task`. Returns the crew and the agent, or null when none. */
export function command(crew: readonly CrewAgent[], role: CrewRole, task: string): { crew: CrewAgent[]; agent: CrewAgent | null } {
  const picked = pickAgent(crew, role);
  if (!picked) return { crew: [...crew], agent: null };
  const next = assign(crew, picked.id, task);
  return { crew: next, agent: next.find((a) => a.id === picked.id) ?? null };
}

/** Status count per state, for the panel header. */
export const statusCounts = (crew: readonly CrewAgent[]): Record<CrewStatus, number> =>
  crew.reduce((acc, a) => ({ ...acc, [a.status]: acc[a.status] + 1 }), { waiting: 0, working: 0, paused: 0 });

/** Normalised distance beyond which an element counts as moved off its last-known position (2% of the screen). */
export const OFF_POSITION = 0.02;

const nameHash = (name: string) => Array.from(name.trim().toLowerCase().replace(/\s+/g, ' '), (c) => c.charCodeAt(0)).reduce((h, c) => (h * 31 + c) >>> 0, 7);

/** The sentinel that owns `name`: a stable pick among the sentinels; null without sentinels. */
export function sentinelFor(crew: readonly CrewAgent[], name: string): CrewAgent | null {
  const sentinels = crew.filter((a) => a.role === 'sentinel');
  return sentinels.length ? sentinels[nameHash(name) % sentinels.length] : null;
}

/** Result of a sentinel recording a sighting: who holds it and where it was before when it moved. */
export interface Observation {
  crew: CrewAgent[];
  sentinel: CrewAgent | null;
  /** The previous last-known position when the element moved more than OFF_POSITION. */
  moved: ForwardedElement | null;
}

/** The owning sentinel records `element` as its last-known position. */
export function observe(crew: readonly CrewAgent[], element: ForwardedElement): Observation {
  const owner = sentinelFor(crew, element.name);
  if (!owner) return { crew: [...crew], sentinel: null, moved: null };
  const before = owner.elements.find((e) => sameElement(e.name, element.name)) ?? null;
  const moved = before && Math.hypot(before.x - element.x, before.y - element.y) > OFF_POSITION ? before : null;
  const next = update(crew, owner.id, (a) => ({ ...a, elements: [element, ...a.elements.filter((e) => !sameElement(e.name, element.name))].slice(0, 100) }));
  return { crew: next, sentinel: next.find((a) => a.id === owner.id) ?? null, moved };
}

/** Instant position query: the owning sentinel's last-known center of `name`, or null. */
export function locate(crew: readonly CrewAgent[], name: string): { agent: CrewAgent; element: ForwardedElement } | null {
  const agent = sentinelFor(crew, name);
  const element = agent?.elements.find((e) => sameElement(e.name, name));
  return agent && element ? { agent, element } : null;
}

/** A path checker's recommendation. */
export type PathAdvice = 'continue' | 'retry' | 'alt' | 'skip' | 'adjust';

/** Whether the run is on path to the goal, and what to do when it is not. */
export interface PathCheck {
  onPath: boolean;
  advice: PathAdvice;
  reason: string;
  /** Index of the step the advice is about, or -1. */
  stepIndex: number;
}

/** Steps whose failure does not block the goal: they can be skipped. */
const SKIPPABLE: ReadonlySet<StepAction> = new Set<StepAction>(['move', 'wait', 'scroll']);

const stepLabel = (s: WorkflowStep, i: number) => `step ${i + 1} "${s.name}"`;

/** Checks the workflow's progress against its plotted route (the step order). */
export function checkPath(steps: readonly WorkflowStep[], goal = ''): PathCheck {
  const toward = goal.trim() ? ` toward "${goal.trim()}"` : '';
  const drifted = steps.findIndex((s) => s.status === 'drift');
  if (drifted >= 0) return { onPath: false, advice: 'adjust', reason: `${stepLabel(steps[drifted], drifted)} drifted off its target${toward} — adjust its coordinates`, stepIndex: drifted };
  const failed = steps.findIndex((s) => s.status === 'failed');
  if (failed >= 0) {
    const s = steps[failed];
    const failures = steps.filter((x) => x.status === 'failed').length;
    if (SKIPPABLE.has(s.action)) return { onPath: false, advice: 'skip', reason: `${stepLabel(s, failed)} failed but is not needed${toward} — skip it`, stepIndex: failed };
    if (failures >= 2) return { onPath: false, advice: 'alt', reason: `${failures} steps failed${toward} — try an alternate method`, stepIndex: failed };
    return { onPath: false, advice: 'retry', reason: `${stepLabel(s, failed)} failed${toward} — retry it`, stepIndex: failed };
  }
  const lastDone = steps.map((s) => s.status).lastIndexOf('done');
  const jumped = steps.findIndex((s, i) => i < lastDone && s.status === 'pending');
  if (jumped >= 0) return { onPath: false, advice: 'retry', reason: `${stepLabel(steps[jumped], jumped)} was passed over — the run left the plotted route${toward}`, stepIndex: jumped };
  return { onPath: true, advice: 'continue', reason: `on path${toward}`, stepIndex: -1 };
}

/** What a notice is about. */
export type NoticeKind = 'off-position' | 'off-path' | 'intercept' | 'test' | 'change' | 'safety' | 'backtrack';

/** One info notification from a crew agent, shown in the HUD and the log. */
export interface CrewNotice {
  id: string;
  time: number;
  agentId: string;
  kind: NoticeKind;
  text: string;
}

/** Most notices kept (newest first). */
export const NOTICE_LIMIT = 50;

/** A new notice from `agentId`. */
export const makeNotice = (agentId: string, kind: NoticeKind, text: string, time = Date.now()): CrewNotice => ({ id: uid('crew'), time, agentId, kind, text });

/** Prepends `notice`, capped at NOTICE_LIMIT. */
export const pushNotice = (list: readonly CrewNotice[], notice: CrewNotice): CrewNotice[] => [notice, ...list].slice(0, NOTICE_LIMIT);

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** The off-position notice for an element seen away from its last-known position. */
export const offPositionText = (now: ForwardedElement, before: ForwardedElement) =>
  `"${now.name}" is off its last-known position: was ${pct(before.x)},${pct(before.y)}, now ${pct(now.x)},${pct(now.y)}`;

/** Where an intercept came from. */
export type InterceptSource = 'bridge' | 'agent' | 'app' | 'ai';
export const INTERCEPT_SOURCES: readonly InterceptSource[] = ['bridge', 'agent', 'app', 'ai'];

/** What the crew proposes after factoring an intercept in. */
export type InterceptProposal = 'apply' | 'reroute' | 'stop' | 'alt' | 'skip';

/** An interruption the crew must pause for. */
export interface Intercept {
  source: InterceptSource;
  text: string;
  /** A point it carries, normalized 0..1 (makes it a reroute). */
  x?: number;
  y?: number;
}

/** The proposal for an intercept: stop / skip / alternate wording first, then a carried point reroutes, else apply. */
export function proposeIntercept(i: Intercept): InterceptProposal {
  if (/\b(stop|abort|cancel|halt)\b/i.test(i.text)) return 'stop';
  if (/\bskip\b/i.test(i.text)) return 'skip';
  if (/\b(alternate|alternative|instead)\b|another way/i.test(i.text)) return 'alt';
  if (typeof i.x === 'number' && typeof i.y === 'number') return 'reroute';
  return 'apply';
}

/** Every working agent pauses to factor in the intercept; returns the crew and the proposal. */
export function routeIntercept(crew: readonly CrewAgent[], i: Intercept): { crew: CrewAgent[]; proposal: InterceptProposal; paused: number } {
  const paused = crew.filter((a) => a.status === 'working').length;
  return { crew: crew.map((a) => (a.status === 'working' ? { ...a, status: 'paused' } : a)), proposal: proposeIntercept(i), paused };
}

/** Paused agents resume their task. */
export const resumeCrew = (crew: readonly CrewAgent[]): CrewAgent[] => crew.map((a) => (a.status === 'paused' ? { ...a, status: 'working' } : a));

/**
 * Parses "/intercept" text: an optional "bridge:" / "agent:" / "app:" / "ai:" source prefix
 * (default ai) and an optional trailing "at x,y" point (0..1 normalized, or percentages).
 */
export function parseIntercept(text: string): Intercept {
  const src = /^\s*(bridge|agent|app|ai)\s*:\s*/i.exec(text);
  const source = (src?.[1].toLowerCase() ?? 'ai') as InterceptSource;
  const rest = src ? text.slice(src[0].length) : text.trim();
  const at = /\s*\bat\s+(\d*\.?\d+)(%?)\s*,\s*(\d*\.?\d+)(%?)\s*$/i.exec(rest);
  if (!at) return { source, text: rest.trim() };
  const unit = (v: string, p: string) => Math.min(1, Math.max(0, p || Number(v) > 1 ? Number(v) / 100 : Number(v)));
  return { source, text: rest.slice(0, at.index).trim(), x: unit(at[1], at[2]), y: unit(at[3], at[4]) };
}
