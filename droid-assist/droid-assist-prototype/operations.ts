import type { LogEntry, StepAction, WorkflowStep } from './types.js';
import { STAGES, type StageId, type StageMap } from './loop-control.js';
import { boundingBox, diffCells, reverify, type DriftCorrection } from './drift.js';
import { sameElement } from './agent-bus.js';
import { similarOperation } from './operation-memory.js';
import { uid } from './planner.js';
import type { CrewAgent } from './agent-crew.js';

/**
 * The Operations agent group: separate specialized agents the main AI delegates the mechanics of
 * execution to. Each has its own loop-control stage, persisted status and reports; the main AI
 * commands them through the crew loop (assign → work → report → wait).
 */

/** Every Operations agent: its id, the loop-control stage that switches it, its name and its role for the main AI. */
export const OPS_AGENTS = [
  { id: 'monitor', stage: 'opsMonitor', name: 'Monitor agent', role: 'watches the live frame and element map and reports what changed' },
  { id: 'logging', stage: 'opsLogging', name: 'Logging agent', role: 'keeps the organized log complete, deduplicated and tagged; reports what the log holds for the operation' },
  { id: 'testing', stage: 'opsTesting', name: 'Testing agent', role: 'tests a named element or proposal: background (dry run) first, then foreground when real input is armed' },
  { id: 'apply', stage: 'opsApply', name: 'Apply agent', role: 'applies an action described in plain words through the real-input path, with before/after evidence, recheck and reapply' },
  { id: 'recheck', stage: 'opsRecheck', name: 'Recheck agent', role: 're-verifies by screenshot comparison that the last applied action took effect' },
  { id: 'reapply', stage: 'opsReapply', name: 'Reapply agent', role: 'reapplies the last action that failed its recheck at corrected coordinates, then escalates for a re-plan' },
  { id: 'loopControl', stage: 'opsLoopControl', name: 'Loop-control agent', role: 'enables or disables a loop-control stage ("disable Reflect") or reports what is running vs disabled' },
  { id: 'placement', stage: 'opsPlacement', name: 'App-placement agent', role: 'steps the assist window aside so the target app is in front, brings it back, or reports the window state' },
  { id: 'screenshots', stage: 'opsScreenshots', name: 'Screenshot-verification agent', role: 'captures the live frame into the evidence trail, or reports the evidence of the operation' },
] as const satisfies ReadonlyArray<{ id: string; stage: StageId; name: string; role: string }>;

/** The id of an Operations agent. */
export type OpsAgentId = (typeof OPS_AGENTS)[number]['id'];

/** Every Operations agent id, in panel order. */
export const OPS_AGENT_IDS: readonly OpsAgentId[] = OPS_AGENTS.map((a) => a.id);

/** The catalogue entry of one agent. */
export const opsAgent = (id: OpsAgentId) => OPS_AGENTS.find((a) => a.id === id)!;

/** True when `id` names an Operations agent. */
export const isOpsAgent = (id: string): id is OpsAgentId => OPS_AGENT_IDS.includes(id as OpsAgentId);

/** The agents whose loop-control stage is checked. */
export const enabledOps = (stages: StageMap): OpsAgentId[] => OPS_AGENTS.filter((a) => stages[a.stage]).map((a) => a.id);

/**
 * Reads the "/ops" target: "<agent>: <task>" commands one agent directly (agent id, any case);
 * anything else is a goal the main AI delegates across the agents.
 */
export function parseOpsTarget(target: string): { agent: OpsAgentId; task: string } | { goal: string } {
  const m = /^([a-z]+)\s*:\s*(.*)$/i.exec(target.trim());
  const agent = m && OPS_AGENT_IDS.find((id) => id.toLowerCase() === m[1].toLowerCase());
  return agent ? { agent, task: m[2].trim() } : { goal: target.trim() };
}

/** System prompt of the main AI commanding the Operations agents. */
export const OPS_SYSTEM = `You are Droid Assist's main AI delegating the mechanics of execution to the Operations agents.
Each agent works one command, reports back and waits for your next command. The agents:
${OPS_AGENTS.map((a) => `- ${a.id}: ${a.role}`).join('\n')}
Give each agent at most one command per round and order the work across rounds (apply before recheck, recheck before reapply).
Reply ONLY with JSON {"done":boolean,"summary":string,"commands":[{"agent":string,"task":string}]}. Set "done" true (and no commands) when the goal is complete or cannot progress.`;

export const AUTO_OPS_SYSTEM = `${OPS_SYSTEM}
For automatic follow-up rounds, assign useful work to at least half of the supplied enabled roster while the screen session is active. Prefer monitoring, logging, screenshot comparison, cross-reference, and background-only testing. Do not assign unrelated UI actions; any Apply work remains subject to the existing briefing, approval, armed-input, abort, and action-budget gates.`;

/** Most reports and evidence entries kept. */
export const OPS_REPORT_LIMIT = 100;
export const EVIDENCE_LIMIT = 50;

/** One report an Operations agent made: to whom it was assigned, what it found, for which operation. */
export interface OpsReport {
  id: string;
  time: number;
  agent: OpsAgentId;
  task: string;
  ok: boolean;
  found: string;
  /** The operation (goal) it was made for. */
  op: string;
}

/** Before/after frames of one applied action, and what the recheck said. */
export interface Evidence {
  id: string;
  time: number;
  op: string;
  step: string;
  action: StepAction;
  /** Normalized point the action was applied at. */
  x: number;
  y: number;
  /** Frame-store ids and display JPEGs of the frames before and after; null when none was captured. */
  beforeId: number | null;
  afterId: number | null;
  before: string | null;
  after: string | null;
  /** Recheck outcome: effect seen, no effect, or not rechecked yet. */
  verdict: 'effect' | 'no-effect' | null;
}

/** Every agent's last command/report plus the report list and the evidence trail (persisted). */
export interface OpsState {
  agents: CrewAgent[];
  reports: OpsReport[];
  evidence: Evidence[];
}

/** Every agent waiting, nothing reported. */
export const EMPTY_OPS: OpsState = { agents: OPS_AGENT_IDS.map((id) => ({ id, status: 'waiting', task: null, lastReport: null })), reports: [], evidence: [] };

/** One agent's status changed (assigned, working, waiting or parked). */
export const patchOpsAgent = (state: OpsState, id: string, change: Partial<CrewAgent>): OpsState => ({ ...state, agents: state.agents.map((a) => (a.id === id ? { ...a, ...change } : a)) });

/** A report recorded first, its agent's last report updated. */
export function addOpsReport(state: OpsState, report: Omit<OpsReport, 'id' | 'time'>, time = Date.now()): OpsState {
  const next = patchOpsAgent(state, report.agent, { lastReport: report.found });
  return { ...next, reports: [{ id: uid('ops'), time, ...report }, ...state.reports].slice(0, OPS_REPORT_LIMIT) };
}

/** Evidence recorded first. */
export const addEvidence = (state: OpsState, evidence: Omit<Evidence, 'id' | 'time' | 'verdict'>, time = Date.now()): OpsState =>
  ({ ...state, evidence: [{ id: uid('ev'), time, verdict: null, ...evidence }, ...state.evidence].slice(0, EVIDENCE_LIMIT) });

/** The recheck verdict written onto one evidence entry. */
export const markEvidence = (state: OpsState, id: string, verdict: Evidence['verdict']): OpsState => ({ ...state, evidence: state.evidence.map((e) => (e.id === id ? { ...e, verdict } : e)) });

/** What the memory panel cross-references for one operation: its agents' reports, evidence and tagged log. */
export function opsFor(operation: string, state: OpsState, log: LogEntry[]) {
  const same = (op: string | undefined) => !!op && similarOperation(operation, op);
  return { reports: state.reports.filter((r) => same(r.op)), evidence: state.evidence.filter((e) => same(e.op)), log: log.filter((l) => same(l.op)) };
}

// ── Logging agent ─────────────────────────────────────────────────────────

/** An entry tagged with its operation; an empty operation leaves it untagged. */
export const tagLog = (entry: LogEntry, op: string | null): LogEntry => (op?.trim() ? { ...entry, op: op.trim() } : entry);

/** Two entries say the same thing (source, message, tone and operation). */
const sameEntry = (a: LogEntry, b: LogEntry) => a.source === b.source && a.message === b.message && a.tone === b.tone && a.op === b.op;

/**
 * Adds `entry` to the newest-first log, capped at `limit`: an entry identical to the newest one is
 * folded into it (its time refreshed, its repeat count raised, screenshots kept) instead of duplicated.
 */
export function dedupeLog(log: LogEntry[], entry: LogEntry, limit: number): LogEntry[] {
  const [first, ...rest] = log;
  if (!first || !sameEntry(first, entry)) return [entry, ...log].slice(0, limit);
  return [{ ...first, time: entry.time, repeat: (first.repeat ?? 1) + 1, ...(entry.shots ? { shots: entry.shots } : {}) }, ...rest];
}

/** The logging agent's report of the log of one operation. */
export function logSummary(log: LogEntry[], op: string): string {
  const mine = log.filter((l) => l.op && similarOperation(op, l.op));
  const folded = mine.reduce((n, l) => n + (l.repeat ?? 1) - 1, 0);
  const problems = mine.filter((l) => l.tone === 'error' || l.tone === 'warn').length;
  return `${mine.length} entr${mine.length === 1 ? 'y' : 'ies'} tagged "${op}" (${problems} warning/error, ${folded} duplicate(s) folded)${mine[0] ? `; latest: [${mine[0].source}] ${mine[0].message}` : ''}`;
}

// ── Monitor agent ─────────────────────────────────────────────────────────

/** A named on-screen box (element map entry). */
export interface NamedBox {
  name: string;
  box: { x: number; y: number; w: number; h: number };
}

/** A change between two frames: how many grid cells, where, and which mapped elements it touches. */
export interface MonitorChange {
  cells: number;
  box: { x: number; y: number; w: number; h: number };
  elements: string[];
}

const overlaps = (a: NamedBox['box'], b: NamedBox['box']) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The change from `prev` to `next` when at least `minCells` grid cells changed; null otherwise. */
export function monitorChange(prev: ImageData, next: ImageData, map: NamedBox[], minCells: number): MonitorChange | null {
  const cells = diffCells(prev, next);
  const box = cells.length >= minCells ? boundingBox(cells) : null;
  return box && { cells: cells.length, box, elements: map.filter((m) => overlaps(m.box, box)).map((m) => m.name) };
}

/** Least time between two monitor reports of the same kind of change. */
export const MONITOR_REPORT_MS = 3000;

/** Key of a change: what it touched, so the same change is not reported every frame. */
export const changeKey = (c: MonitorChange) => (c.elements.length ? c.elements.join('|') : `${c.box.x.toFixed(2)}:${c.box.y.toFixed(2)}`);

/** Whether a change is worth a report: a different change, or the same one after MONITOR_REPORT_MS. */
export const shouldReport = (last: { key: string; time: number } | null, change: MonitorChange, now: number) =>
  !last || last.key !== changeKey(change) || now - last.time >= MONITOR_REPORT_MS;

/** One-line text of a change. */
export const changeLine = (c: MonitorChange) => `${c.cells} cell(s) changed at (${(c.box.x * 100).toFixed(0)}%, ${(c.box.y * 100).toFixed(0)}%)${c.elements.length ? ` touching ${c.elements.map((e) => `"${e}"`).join(', ')}` : ''}`;

/** Names added to and removed from the element map. */
export function mapDelta(before: string[], after: string[]) {
  return { added: after.filter((n) => !before.includes(n)), removed: before.filter((n) => !after.includes(n)) };
}

// ── Testing agent ─────────────────────────────────────────────────────────

/** A named point the testing agent can test (watcher proposal, mapped, familiar or known element). */
export interface TestCandidate {
  name: string;
  x: number;
  y: number;
  /** The watcher proposal it came from, when any. */
  proposalId?: string;
}

/** The click that tests the candidate named by `task` (exact name first, then the first name it contains); null when none matches. */
export function testTarget(task: string, candidates: TestCandidate[]): { step: WorkflowStep; proposalId: string } | null {
  const text = task.toLowerCase();
  const hit = candidates.find((c) => sameElement(c.name, task)) ?? candidates.find((c) => c.name.trim() && text.includes(c.name.trim().toLowerCase()));
  if (!hit) return null;
  return { step: { id: uid('opstest'), name: `Ops test: ${hit.name}`, action: 'click', target: hit.name, x: hit.x, y: hit.y, status: 'pending' }, proposalId: hit.proposalId ?? '' };
}

// ── Recheck and reapply agents ────────────────────────────────────────────

/** Actions whose success is expected to change the screen; others pass recheck without a visible effect. */
const VISIBLE_EFFECT: ReadonlySet<StepAction> = new Set<StepAction>(['click', 'double_click', 'drag', 'type', 'key', 'scroll']);

/** The recheck agent's verdict on one applied action. */
export interface RecheckVerdict {
  ok: boolean;
  detail: string;
}

/** Compares the frames before and after an action at its point: an effect action must visibly change the screen. */
export function recheckVerdict(before: ImageData, after: ImageData, step: Pick<WorkflowStep, 'action' | 'x' | 'y'>): RecheckVerdict {
  const r = reverify(before, after, step.x, step.y);
  const numbers = `target ${r.targetChange.toFixed(3)}, frame ${r.frameChange.toFixed(3)}`;
  if (!VISIBLE_EFFECT.has(step.action)) return { ok: true, detail: `no visible effect expected for ${step.action} (${numbers})` };
  return r.changed ? { ok: true, detail: `intended effect seen (${numbers})` } : { ok: false, detail: `no visible effect after ${step.action} (${numbers})` };
}

/** The reapply agent's next move: retry at a point, or escalate to the main AI for a re-plan. */
export type ReapplyDecision = { kind: 'retry'; at: { x: number; y: number }; why: string } | { kind: 'escalate'; why: string };

/**
 * Reapply attempt `attempt` (1-based) with `limit` allowed: past the limit, with no reference frame
 * to correct against, with the target not found on the live frame, or when the corrected point is
 * one already `tried` (no new correction), it escalates; otherwise it retries at the corrected point.
 */
export function decideReapply(attempt: number, limit: number, correction: Pick<DriftCorrection, 'level' | 'x' | 'y' | 'driftPx'> | null, tried: Array<{ x: number; y: number }>): ReapplyDecision {
  if (attempt > limit) return { kind: 'escalate', why: `reapply limit (${limit}) reached` };
  if (!correction) return { kind: 'escalate', why: 'no reference frame to correct against' };
  if (correction.level === 'red') return { kind: 'escalate', why: 'target not found on the live frame' };
  const same = (p: { x: number; y: number }) => Math.abs(p.x - correction.x) < 1e-3 && Math.abs(p.y - correction.y) < 1e-3;
  if (tried.some(same)) return { kind: 'escalate', why: 'no new correction — the corrected point already failed recheck' };
  return { kind: 'retry', at: { x: correction.x, y: correction.y }, why: `target moved ${correction.driftPx}px — retrying at the corrected point` };
}

// ── Loop-control agent ────────────────────────────────────────────────────

/** A loop-control command: switch one stage, report, or a stage name that matched nothing. */
export type LoopCommand = { kind: 'toggle'; id: StageId; on: boolean } | { kind: 'report' } | { kind: 'unknown'; name: string };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ON_WORDS = new Set(['enable', 'check', 'turn on', 'start', 'resume']);

/** Reads "disable Reflect", "enable the screen watcher", "turn off grounding"; anything else is a report. */
export function parseLoopCommand(task: string): LoopCommand {
  const m = /\b(enable|disable|check|uncheck|turn on|turn off|start|stop|resume|pause)\b\s+(?:the\s+)?(.+)/i.exec(task);
  if (!m) return { kind: 'report' };
  const name = norm(m[2].replace(/\bstage\b/i, ''));
  const stage = STAGES.find((s) => norm(s.name) === name || norm(s.id) === name) ?? STAGES.find((s) => norm(s.name).includes(name) || name.includes(norm(s.name)));
  return stage ? { kind: 'toggle', id: stage.id, on: ON_WORDS.has(m[1].toLowerCase()) } : { kind: 'unknown', name: m[2].trim() };
}

/** Which stages are running right now, which are on but idle, and which are disabled. */
export function loopReport(stages: StageMap, running: StageId[]) {
  const named = (pick: (id: StageId) => boolean) => STAGES.filter((s) => pick(s.id)).map((s) => s.name);
  const report = { running: named((id) => stages[id] && running.includes(id)), idle: named((id) => stages[id] && !running.includes(id)), disabled: named((id) => !stages[id]) };
  return { ...report, text: `Running: ${report.running.join(', ') || 'none'} · Disabled: ${report.disabled.join(', ') || 'none'} · ${report.idle.length} stage(s) on and idle` };
}

// ── App-placement agent ───────────────────────────────────────────────────

/** A placement command: step the assist window aside, bring it back, or report its state. */
export type PlacementCommand = 'aside' | 'back' | 'state';

/** Reads a placement task ("bring Notepad to front" steps aside; "restore the assist window" brings it back). */
export function parsePlacement(task: string): PlacementCommand {
  if (/\b(restore|bring (it |the assist( window)? )?back|show (the )?assist)\b/i.test(task)) return 'back';
  if (/\b(front|foreground|aside|minimi[sz]e|hide|focus|out of the way)\b/i.test(task)) return 'aside';
  return 'state';
}

/** The honest answer in a browser, where no window can be placed. */
export const PLACEMENT_UNSUPPORTED = 'Window placement is unsupported in the browser — bring the target app to front yourself (the Electron app can step the assist window aside)';

/** Actions that need the target app in the foreground. */
export const needsForeground = (action: StepAction) => VISIBLE_EFFECT.has(action) || action === 'move';

// ── Persistence ───────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strOrNull = (v: unknown) => v === null || typeof v === 'string';
const numOrNull = (v: unknown) => v === null || isNum(v);
const STATUSES: ReadonlyArray<CrewAgent['status']> = ['waiting', 'working', 'parked'];

function isReport(v: unknown): v is OpsReport {
  return isObject(v) && typeof v.id === 'string' && isNum(v.time) && typeof v.agent === 'string' && isOpsAgent(v.agent)
    && typeof v.task === 'string' && typeof v.ok === 'boolean' && typeof v.found === 'string' && typeof v.op === 'string';
}

function isEvidence(v: unknown): v is Evidence {
  return isObject(v) && typeof v.id === 'string' && isNum(v.time) && typeof v.op === 'string' && typeof v.step === 'string' && typeof v.action === 'string'
    && isNum(v.x) && isNum(v.y) && numOrNull(v.beforeId) && numOrNull(v.afterId) && strOrNull(v.before) && strOrNull(v.after)
    && (v.verdict === null || v.verdict === 'effect' || v.verdict === 'no-effect');
}

/** A stored agent merged over its default; a stored "working" agent was interrupted and is waiting again. */
function readAgent(id: OpsAgentId, stored: unknown[]): CrewAgent {
  const s = stored.find((a): a is Json => isObject(a) && a.id === id);
  const status = s && STATUSES.includes(s.status as CrewAgent['status']) && s.status !== 'working' ? (s.status as CrewAgent['status']) : 'waiting';
  return { id, status, task: typeof s?.task === 'string' ? s.task : null, lastReport: typeof s?.lastReport === 'string' ? s.lastReport : null };
}

/** The stored Operations state, invalid entries dropped. */
export function readOpsState(raw: unknown): OpsState {
  if (!isObject(raw)) return EMPTY_OPS;
  const agents = Array.isArray(raw.agents) ? raw.agents : [];
  const list = <T>(v: unknown, guard: (x: unknown) => x is T, limit: number) => (Array.isArray(v) ? v.filter(guard).slice(0, limit) : []);
  return { agents: OPS_AGENT_IDS.map((id) => readAgent(id, agents)), reports: list(raw.reports, isReport, OPS_REPORT_LIMIT), evidence: list(raw.evidence, isEvidence, EVIDENCE_LIMIT) };
}
