import type { FamiliarElement, Frame, LogEntry, WorkflowStep } from './types.js';
import { AiError, SAMPLE_VIEW, askRetryingSchema, parseJsonReply } from './ai.js';
import type { AskFn, ViewSize } from './ai.js';
import { gridPrompt, replyPoint } from './grid.js';
import { planSystem, toStep, uid } from './planner.js';
import { sameElement } from './rearrange.js';
import { boxCenter, type MappedElement } from './element-map-studio.js';
import type { Thought } from './assist-ai.js';

/** Where an objective stands: planned, being worked, done, failed, or never reached because an earlier one failed. */
export type ObjectiveStatus = 'pending' | 'running' | 'done' | 'failed' | 'not run';

/** One element of a multi-element chain: what to do, why, the step that does it and the elements on the way there. */
export interface ChainObjective {
  id: string;
  name: string;
  what: string;
  why: string;
  /** The action pre-staged for the moment the target is reached (click, type, key…). */
  step: WorkflowStep;
  /** Elements to pass through, in order, before acting on the target. */
  path: string[];
  /** Where the target probably hides when it is not visible (\"behind the Actions menu\"); null when it should be visible. */
  discover: string | null;
  status: ObjectiveStatus;
  /** Why the objective failed or was not run. */
  reason?: string;
  /** Screenshots just before and just after the objective's action. */
  before?: Frame;
  after?: Frame;
}

/** A planned chain and the planner's thinking. */
export interface ChainPlan extends Thought {
  objectives: ChainObjective[];
}

/** Per-objective completion of a chain: complete only when every objective is done. */
export interface ChainReport {
  complete: boolean;
  failed: { name: string; reason: string } | null;
  text: string;
}

/** A chain run as the panels show it. */
export interface ChainRun {
  goal: string;
  objectives: ChainObjective[];
  report: ChainReport | null;
}

/** The goal's clauses: split on commas, semicolons and "then". */
export const splitClauses = (goal: string) => goal.split(/\s*(?:[,;]|\bthen\b)\s*/i).map((c) => c.replace(/^and\s+/i, '').trim()).filter(Boolean);

/** A goal names several elements in order (2+ clauses) and runs as one chain. */
export const isChainGoal = (goal: string) => splitClauses(goal).length >= 2;

/** System prompt of the chain planner, for a `view`-sized screenshot. */
export const chainSystem = (view: ViewSize) => `${planSystem(view)}
This goal is a MULTI-ELEMENT CHAIN: produce the full objective breakdown, one objective per element the goal names, in the order the goal names them.
Reply ONLY with JSON: {"objectives":[{"name":string,"what":string,"why":string,"action":string,"target":string,"cell":string,"cx":number,"cy":number,"text"?:string,"path"?:string[],"discover"?:string}]}
"what" says what the objective does to which element; "why" says how it moves the goal forward.
"action","target","cell","cx","cy","text" are the step that completes the objective (same rules as a plan step) and run as soon as the target is reached.
"path" lists the on-screen elements to pass through, in order, before reaching the target (empty when it is reached directly).
When the target is not visible on this screen, omit "cell","cx","cy" and say in "discover" where it probably is (e.g. "behind the Actions menu", "further down the list").`;

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** One model objective as a ChainObjective; throws AiError when its step breaks the contract. */
function toObjective(raw: unknown, frame: Frame | null, view: ViewSize): ChainObjective {
  const o = (raw ?? {}) as Record<string, unknown>;
  const step = toStep(o, frame, view);
  return {
    id: uid('objective'),
    name: step.name,
    what: text(o.what) || `${step.action} "${step.target ?? step.name}"`,
    why: text(o.why) || 'Named by the goal',
    step,
    path: Array.isArray(o.path) ? o.path.map(text).filter(Boolean) : [],
    discover: text(o.discover) || null,
    status: 'pending',
  };
}

/** Parses the chain planner's reply; throws AiError on a malformed or empty breakdown. */
export function parseChain(reply: string, frame: Frame | null, view: ViewSize = SAMPLE_VIEW): ChainObjective[] {
  const raw = parseJsonReply(reply).objectives;
  if (!Array.isArray(raw) || !raw.length) throw new AiError('AI returned no objectives for this chain');
  return raw.map((o) => toObjective(o, frame, view));
}

/** Asks the model for the objective breakdown of a multi-element goal on the live frame. */
export async function planChain(goal: string, frame: Frame | null, ask: AskFn, context: string[] = []): Promise<ChainPlan> {
  const clauses = splitClauses(goal).map((c, i) => `${i + 1}. ${c}`).join('\n');
  const reply = await ask({ system: chainSystem, prompt: `Goal: ${goal}\nElements in order:\n${clauses}`, frame, context, json: true });
  return { objectives: parseChain(reply.content, frame, reply.view), thinking: reply.thinking };
}

/** A located element and which memory located it. */
export type Located = { x: number; y: number; source: 'element map' | 'learned coordinates' };

/** Locates an element by name: the user's element map first, then the learned (familiar) coordinates; null when neither knows it. */
export function locateTarget(name: string, map: MappedElement[], familiar: FamiliarElement[]): Located | null {
  const mapped = map.find((e) => sameElement(e.name, name));
  if (mapped) return { ...boxCenter(mapped.box), source: 'element map' };
  const known = familiar.find((e) => sameElement(e.name, name));
  return known ? { x: known.x, y: known.y, source: 'learned coordinates' } : null;
}

/** Most exploratory scroll/click steps discovery makes for one objective. */
export const MAX_DISCOVERY = 3;

/** One discovery decision: the target is visible now, try one exploratory step, or give up. */
export type DiscoveryMove = ({ kind: 'found'; x: number; y: number } | { kind: 'explore'; step: WorkflowStep } | { kind: 'give-up' }) & { why: string };

const EXPLORE_ACTIONS = new Set(['scroll', 'click', 'move']);

/** System prompt of the discovery agent, for a `view`-sized screenshot. */
const discoverySystem = (view: ViewSize) => `You are a discovery agent discovering a hidden element on a computer screen (${view.w}x${view.h} screenshot).
${gridPrompt(view)}
If the element is visible now, reply {"visible":true,"cell":string,"cx":number,"cy":number,"why":string}.
Otherwise reply with ONE exploratory step that reveals it — scroll a list or menu ("action":"scroll","text":"up"|"down") or open a menu/tab ("action":"click"):
{"visible":false,"step":{"name":string,"action":"scroll"|"click","target":string,"cell":string,"cx":number,"cy":number,"text"?:string},"why":string}
Reply {"visible":false,"step":null,"why":string} when nothing on screen can reveal it.`;

/** Parses a discovery reply; throws AiError when it proposes anything but a scroll, click or move. */
export function parseDiscovery(reply: string, frame: Frame | null, view: ViewSize = SAMPLE_VIEW): DiscoveryMove {
  const r = parseJsonReply(reply);
  const why = text(r.why) || 'no reason given';
  if (r.visible === true) return { kind: 'found', ...replyPoint(r, undefined, view), why };
  if (r.step === null || r.step === undefined) return { kind: 'give-up', why };
  const step = toStep(r.step, frame, view);
  if (!EXPLORE_ACTIONS.has(step.action)) throw new AiError(`Discovery proposed "${step.action}" — only scroll, click or move explore`);
  return { kind: 'explore', step, why };
}

/** The discovery reply contract (found shape), quoted in the schema retry. */
const DISCOVERY_SCHEMA = '{"visible":true,"cell":string,"cx":number,"cy":number,"why":string} or {"visible":false,"step":{...}|null,"why":string}';

/** Asks the discovery agent where the objective's target is, told what was already tried; a non-numeric point is asked once more. */
export async function discoverTarget(ask: AskFn, frame: Frame | null, o: ChainObjective, tried: string[]): Promise<DiscoveryMove & Thought> {
  const hint = o.discover ? `\nHint: ${o.discover}` : '';
  const done = tried.length ? `\nAlready tried: ${tried.join('; ')}` : '';
  const req = { system: discoverySystem, prompt: `Find: ${o.step.target ?? o.name} (to ${o.what})${hint}${done}`, frame, json: true };
  return askRetryingSchema(ask, req, DISCOVERY_SCHEMA, (reply) => ({ ...parseDiscovery(reply.content, frame, reply.view), thinking: reply.thinking }));
}

/** One line of the per-objective report. */
export const objectiveLine = (o: ChainObjective, i: number) => `${i + 1}. ${o.name} — ${o.status}${o.reason ? `: ${o.reason}` : ''}`;

/** Log and panel tone of each objective status. */
export const OBJECTIVE_TONE: Record<ObjectiveStatus, LogEntry['tone']> = { pending: 'warn', running: 'warn', done: 'ok', failed: 'error', 'not run': 'warn' };

/** The chain's completion report: COMPLETE when every objective is done, else INCOMPLETE naming the failed objective and why. */
export function chainReport(objectives: ChainObjective[]): ChainReport {
  const done = objectives.filter((o) => o.status === 'done').length;
  const index = objectives.findIndex((o) => o.status === 'failed');
  if (done === objectives.length) return { complete: true, failed: null, text: `Chain COMPLETE — ${done}/${objectives.length} objectives done` };
  const failed = index >= 0 ? { name: objectives[index].name, reason: objectives[index].reason ?? 'no reason recorded' } : null;
  const stopped = failed ? `objective ${index + 1} "${failed.name}" failed: ${failed.reason}` : 'stopped before every objective ran';
  const notRun = objectives.filter((o) => o.status === 'not run').length;
  return { complete: false, failed, text: `Chain INCOMPLETE — ${stopped} (${done}/${objectives.length} done, ${notRun} not run)` };
}
