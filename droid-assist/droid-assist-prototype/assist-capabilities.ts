/**
 * The assist app's capability catalogue: every feature as a registry entry over the engine's
 * operations. The engine (useAssist) supplies the operations; buttons, the AI, agents and the
 * main Droid app all reach them only through these entries.
 */
import type { Capability, ParamSpec, Params, Requester } from './capabilities.js';
import { AGENT_STAGE, LIVE_SETTINGS, requesterName, type LiveSetting } from './capabilities.js';
import { STAGES, type StageId } from './loop-control.js';
import type { Box } from './assist-ai.js';
import type { AssistStatus } from './main-app-bridge.js';

/** The background agents the user (or the AI) can switch on and off. */
export const AGENT_TOGGLES = ['popup', 'drift', 'progress', 'goal', 'identify', 'screen', 'coords', 'supervisor'] as const;
export type AgentToggle = (typeof AGENT_TOGGLES)[number];

/** What the engine does for each capability; text results are what the invocation log records. */
export interface AssistOps {
  plan: (goal: string) => Promise<boolean>;
  replay: (selfTest: boolean) => Promise<void>;
  /** The end-to-end AI self-test (plan → ground → execute → verify on the live frame); resolves its report line. */
  selfTest: () => Promise<string>;
  stop: () => void;
  toggleRecording: () => void;
  setStage: (id: StageId, on: boolean) => void;
  setAgent: (id: AgentToggle, on: boolean) => void;
  adjustSetting: (key: LiveSetting, value: unknown, requester: Requester) => string;
  setAutoAct: (on: boolean) => void;
  setRelaxed: (on: boolean) => string;
  saveWorkflow: (name?: string) => string;
  loadWorkflow: (nameOrId: string) => string;
  workflows: () => string[];
  schedule: (name: string, inSec: number, everySec: number, flow?: string) => string;
  toggleTrigger: (id: string) => void;
  fireTrigger: (id: string) => Promise<void>;
  triggers: () => string[];
  stats: () => string;
  exportBackup: () => string;
  exportHistory: (format: 'json' | 'csv') => void;
  snip: (box: Box) => Promise<string>;
  rulerToggle: () => void;
  recalibrate: () => string;
  measure: (text: string, by: string) => string;
  toggleMapMode: () => void;
  elements: () => string[];
  testElement: (name: string, x: number, y: number) => Promise<void>;
  testRoutes: (spec: string) => Promise<void>;
  supervise: () => Promise<void>;
  sections: (goal: string) => Promise<string[]>;
  ask: (question?: string) => Promise<string>;
  verifyScreen: (goal: string) => Promise<string>;
  /** Template-matches the next step's target on the current source's live frame: its sync level, or why it cannot. */
  driftCheck: () => Promise<string>;
  reverseLast: () => Promise<void>;
  setArmed: (on: boolean) => void;
  abort: (reason: string) => void;
  clearAbort: () => void;
  setBudget: (limit: number) => string;
  status: () => AssistStatus;
  /** Every structured blacklist rule as one line (id, scope, source, state, expiry). */
  blacklist: () => string[];
  /** Clears one blacklist rule by id, or all of them for 'all'; the result says what was cleared. */
  clearBlacklist: (id?: string) => string;
}

type Ops = () => AssistOps;
type Flags = Pick<Capability, 'guardrail' | 'stage' | 'realInput' | 'readOnly'>;

const str = (description: string, required = true): ParamSpec => ({ type: 'string', description, required });
const bool = (description: string): ParamSpec => ({ type: 'boolean', description, required: true });
const unit = (description: string): ParamSpec => ({ type: 'number', description, required: true, min: 0, max: 1 });
const seconds = (description: string, required = true): ParamSpec => ({ type: 'number', description, required, min: 0, max: 7 * 24 * 3600 });

const cap = (id: string, description: string, params: Capability['params'], invoke: Capability['invoke'], flags: Flags = {}): Capability => ({ id, description, params, invoke, ...flags });
const list = (items: string[], empty: string) => (items.length ? items.join('\n') : empty);
const onOff = (on: unknown) => (on ? 'on' : 'off');

/** Planner, replay/playback, recording, auto-continue and the other pipeline stages. */
function pipelineCaps(ops: Ops): Capability[] {
  return [
    cap('plan.goal', 'Plan steps for a goal on the live screen', { goal: str('the goal') }, async (p) => ((await ops().plan(String(p.goal))) ? 'planned' : 'no plan made — see the log')),
    cap('replay.run', 'Run (play back) the current steps; selfTest verifies without input', { selfTest: { type: 'boolean', description: 'verify only' } }, async (p) => {
      await ops().replay(p.selfTest === true);
      return `${p.selfTest ? 'self-test' : 'playback'} finished — see the log`;
    }, { realInput: true }),
    cap('selftest.run', 'AI self-test: plan → ground → execute → verify a goal end to end on the live frame (dry run unless armed)', {}, () => ops().selfTest(), { realInput: true, stage: 'selfTest' }),
    cap('replay.stop', 'Stop the running replay', {}, () => {
      ops().stop();
      return 'stopped';
    }),
    cap('record.toggle', 'Start or stop recording steps', {}, () => {
      ops().toggleRecording();
      return 'recording toggled';
    }),
    cap('reverse.last', 'Undo the most recent real action', {}, async () => {
      await ops().reverseLast();
      return 'reversal finished — see the log';
    }, { realInput: true }),
  ];
}

/** One on/off capability per loop-control stage, owned by that stage. */
const stageCaps = (ops: Ops): Capability[] => STAGES.map((s) => cap(`stage.${s.id}`, `Loop control: ${s.name} on/off`, { on: bool('on') }, (p) => {
  ops().setStage(s.id, p.on === true);
  return `${s.name} ${onOff(p.on)}`;
}, { stage: s.id }));

/** One on/off capability per background agent, owned by that agent's stage. */
const agentCaps = (ops: Ops): Capability[] => AGENT_TOGGLES.map((id) => cap(`agent.${id}`, `Agent ${id} on/off`, { on: bool('on') }, (p) => {
  ops().setAgent(id, p.on === true);
  return `agent ${id} ${onOff(p.on)}`;
}, { stage: AGENT_STAGE[id] }));

/** One live adjustment per validated setting (cadence, retries, monitor mode, view resolution). */
const settingCaps = (ops: Ops): Capability[] => (Object.keys(LIVE_SETTINGS) as LiveSetting[]).map((key) => cap(`setting.${key}`, `Live-adjust ${LIVE_SETTINGS[key].description}`, { value: { ...LIVE_SETTINGS[key], required: true } }, (p, r) => ops().adjustSetting(key, p.value, r)));

/** Monitor automation: notifications auto-act, relaxation mode. */
function modeCaps(ops: Ops): Capability[] {
  return [
    cap('autoact.set', 'Notifications auto-act: react to screen changes and popups on/off', { on: bool('on') }, (p) => {
      ops().setAutoAct(p.on === true);
      return `Auto Act ${onOff(p.on)}`;
    }, { realInput: true }),
    cap('relax.set', 'Relaxation mode: slowest capture, Auto Act off; off restores the previous settings', { on: bool('on') }, (p) => ops().setRelaxed(p.on === true)),
  ];
}

/** Saved operations / workflow packs (Library cards), triggers and the wake timer. */
function libraryCaps(ops: Ops): Capability[] {
  return [
    cap('workflow.save', 'Save the current steps as a workflow (saved operation)', { name: str('workflow name', false) }, (p) => ops().saveWorkflow(p.name as string | undefined)),
    cap('workflow.load', 'Load a saved workflow by name or id', { name: str('workflow name or id') }, (p) => ops().loadWorkflow(String(p.name))),
    cap('workflow.list', 'List saved workflows', {}, () => list(ops().workflows(), 'no saved workflows'), { readOnly: true }),
    cap('trigger.schedule', 'Schedule a workflow (or the draft) to run in N seconds, repeating every M seconds', { name: str('trigger name'), inSec: seconds('delay'), everySec: seconds('repeat interval (0 = once)', false), flow: str('workflow name or id', false) }, (p) => ops().schedule(String(p.name), Number(p.inSec), Number(p.everySec ?? 0), p.flow as string | undefined), { realInput: true }),
    cap('wake.set', 'Wake timer: run a workflow (or the draft) once in N seconds', { inSec: seconds('delay'), flow: str('workflow name or id', false) }, (p) => ops().schedule('Wake timer', Number(p.inSec), 0, p.flow as string | undefined), { realInput: true }),
    cap('trigger.toggle', 'Enable or disable a trigger by id', { id: str('trigger id') }, (p) => {
      ops().toggleTrigger(String(p.id));
      return 'trigger toggled';
    }),
    cap('trigger.fire', 'Run a trigger now by id', { id: str('trigger id') }, async (p) => {
      await ops().fireTrigger(String(p.id));
      return 'trigger fired — see the log';
    }, { realInput: true }),
    cap('trigger.list', 'List triggers', {}, () => list(ops().triggers(), 'no triggers'), { readOnly: true }),
    cap('blacklist.list', 'List the active blacklist (structured avoid rules: scope, source, state, expiry)', {}, () => list(ops().blacklist(), 'blacklist empty'), { readOnly: true }),
    cap('blacklist.clear', 'Clear one blacklist entry by id, or every entry with "all"', { id: str('rule id, or "all" (default)', false) }, (p) => ops().clearBlacklist(typeof p.id === 'string' && p.id.trim() ? p.id.trim() : 'all')),
  ];
}

/** Read-only views: status, stats, element map, screen sections, side research, verification, ruler. */
function readCaps(ops: Ops): Capability[] {
  return [
    cap('status.get', 'Current assist state', {}, () => JSON.stringify(ops().status()), { readOnly: true }),
    cap('stats.summary', 'Run statistics', {}, () => ops().stats(), { readOnly: true }),
    cap('elements.list', 'Known and mapped screen elements', {}, () => list(ops().elements(), 'no elements known'), { readOnly: true }),
    cap('sections.list', 'Screen sections the AI sees for a goal', { goal: str('what to list (e.g. "the nav links")') }, async (p) => list(await ops().sections(String(p.goal)), 'no sections found'), { readOnly: true }),
    cap('research.ask', 'Side research: ask the AI about the live screen', { question: str('question (default: what needs attention)', false) }, (p) => ops().ask(p.question as string | undefined), { readOnly: true }),
    cap('screen.verify', 'Screenshot verification: is the goal complete on the live screen?', { goal: str('goal (default: the current one)', false) }, (p) => ops().verifyScreen(String(p.goal ?? '')), { readOnly: true }),
    cap('drift.check', 'Drift check: is the next step\'s target where it was recorded on the live screen (any capture source)?', {}, () => ops().driftCheck(), { readOnly: true }),
    cap('ruler.measure', 'Measure distances between named elements or coordinates, e.g. "Files icon to left edge" or "0.2,0.3 to 0.8,0.3"; the result goes into planning context and the log', { text: str('endpoints joined by " to "') }, (p, r) => ops().measure(String(p.text), `Ruler (${requesterName(r)})`), { readOnly: true }),
    cap('snip.capture', 'Snip tool: crop a box of the live frame into the log', { x: unit('left'), y: unit('top'), w: unit('width'), h: unit('height') }, (p) => ops().snip({ x: Number(p.x), y: Number(p.y), w: Number(p.w), h: Number(p.h) }), { readOnly: true }),
  ];
}

/** Tools: ruler, element map, backup/export, element and route tests, supervisor. */
function toolCaps(ops: Ops): Capability[] {
  const done = (fn: () => void, text: string) => () => {
    fn();
    return text;
  };
  return [
    cap('ruler.toggle', 'Ruler mode on/off', {}, done(() => ops().rulerToggle(), 'ruler toggled')),
    cap('ruler.recalibrate', 'Re-measure the baseline references and rescale on drift', {}, () => ops().recalibrate()),
    cap('map.toggle', 'Element-map drawing mode on/off', {}, done(() => ops().toggleMapMode(), 'map mode toggled')),
    cap('backup.export', 'Download a backup of every store now', {}, () => ops().exportBackup()),
    cap('history.export', 'Download the action history', { format: { type: 'string', description: 'file format', values: ['json', 'csv'], required: true } }, (p) => {
      ops().exportHistory(p.format as 'json' | 'csv');
      return `history exported as ${String(p.format)}`;
    }),
    cap('test.element', 'Background test of one element: click its point (dry run unless armed)', { name: str('element name'), x: unit('x'), y: unit('y') }, async (p) => {
      await ops().testElement(String(p.name), Number(p.x), Number(p.y));
      return 'element test finished — see the log';
    }, { realInput: true, stage: 'subagents' }),
    cap('test.routes', 'Test links or a route with subagents, e.g. "test the nav links"', { spec: str('what to test') }, async (p) => {
      await ops().testRoutes(String(p.spec));
      return 'link/route test finished — see the report';
    }, { realInput: true, stage: 'supervisor' }),
    cap('supervisor.review', 'Supervisor reviews the last run now', {}, async () => {
      await ops().supervise();
      return 'review finished — see the Supervisor panel';
    }, { stage: 'supervisor' }),
  ];
}

/** Arm/disarm, kill-switch, abort-clear and budget: user-only. */
function guardrailCaps(ops: Ops): Capability[] {
  const guard: Flags = { guardrail: true };
  return [
    cap('guard.arm', 'Arm or disarm real input', { on: bool('armed') }, (p) => {
      ops().setArmed(p.on === true);
      return p.on ? 'armed' : 'disarmed';
    }, guard),
    cap('guard.abort', 'Emergency stop (kill-switch)', { reason: str('reason', false) }, (p) => {
      ops().abort(String(p.reason ?? 'stop button'));
      return 'aborted';
    }, guard),
    cap('guard.clearAbort', 'Clear the abort latch', {}, () => {
      ops().clearAbort();
      return 'abort cleared';
    }, guard),
    cap('guard.budget', 'Set the real-input action budget per run', { limit: { type: 'number', description: 'actions', required: true, min: 1 } }, (p) => ops().setBudget(Number(p.limit)), guard),
  ];
}

/** Every capability of the assist app over `ops` (read lazily, so the latest engine state is used). */
export const assistCapabilities = (ops: Ops): Capability[] => [
  ...pipelineCaps(ops), ...stageCaps(ops), ...agentCaps(ops), ...settingCaps(ops), ...modeCaps(ops),
  ...libraryCaps(ops), ...readCaps(ops), ...toolCaps(ops), ...guardrailCaps(ops),
];

export type { Params };
