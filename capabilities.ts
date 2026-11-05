/**
 * The capability registry: every feature of the assist app as an id, a description, typed
 * parameters and an invoke function. UI buttons, the main AI, bus agents and the main Droid app
 * all dispatch through one registry, so they share one permission check and one invocation log.
 */
import type { AssistSettings, MonitorMode } from './types.js';
import type { BusAgentId } from './agent-bus.js';
import { AI_VIEWS, type AiView } from './ai.js';
import { MODES, RANGES } from './storage.js';
import { stageOf, type StageId } from './loop-control.js';

/** One parameter of a capability. */
export interface ParamSpec {
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
  /** Allowed values of a string parameter. */
  values?: readonly string[];
  min?: number;
  max?: number;
}

export type Params = Record<string, unknown>;

/** Every agent that may request a capability, with the loop-control stage it owns. */
export const AGENT_STAGE = {
  popup: 'popup',
  drift: 'drift',
  progress: 'progress',
  goal: 'goal',
  screen: 'screenWatcher',
  identify: 'identify',
  coords: 'coords',
  habits: 'coords',
  supervisor: 'supervisor',
  elementMap: 'elementMap',
  subagents: 'subagents',
  sidetest: 'sideTests',
  operations: 'opsMonitor',
} as const satisfies Record<Exclude<BusAgentId, 'mainApp'> | 'identify' | 'elementMap' | 'subagents', StageId>;

export type AgentId = keyof typeof AGENT_STAGE;

/** Who asked for a capability. */
export type Requester = { kind: 'user' } | { kind: 'ai' } | { kind: 'agent'; agent: AgentId } | { kind: 'main-app' };

/** One registered feature. */
export interface Capability {
  id: string;
  description: string;
  params: Record<string, ParamSpec>;
  /** Arm/disarm, kill-switch, abort, budget: only the user may invoke it. */
  guardrail?: boolean;
  /** The loop-control stage it toggles or belongs to: an agent may invoke it only for its own stage. */
  stage?: StageId;
  /** It sends real mouse/keyboard input (through the armed, budgeted, briefed executor). */
  realInput?: boolean;
  /** It only reads state; read-only capabilities are what the main Droid app may query. */
  readOnly?: boolean;
  /** Performs the feature; resolves to its result text, rejects with the reason it failed. */
  invoke: (params: Params, requester: Requester) => Promise<string> | string;
}

/** A capability request as the AI or the main app sends it. */
export interface CapabilityRequest {
  id: string;
  params: Params;
}

/** One logged invocation: who asked for what, with which parameters, and what happened. */
export interface InvocationRecord {
  time: number;
  requester: string;
  id: string;
  params: Params;
  ok: boolean;
  result: string;
}

/** Most invocation records kept. */
export const INVOCATION_LIMIT = 100;

/** The requester as log text. */
export const requesterName = (r: Requester) => (r.kind === 'agent' ? `agent:${r.agent}` : r.kind);

/** Why `requester` may not invoke `cap`, or null when it may. */
export function permission(cap: Capability, requester: Requester): string | null {
  if (requester.kind === 'user') return null;
  if (cap.guardrail) return `"${cap.id}" is a guardrail — only the user may invoke it`;
  if (requester.kind === 'ai' || !cap.stage) return null;
  const own = requester.kind === 'agent' ? AGENT_STAGE[requester.agent] : null;
  return own === cap.stage ? null : `${requesterName(requester)} may not invoke "${cap.id}" — it belongs to the ${stageOf(cap.stage).name} stage`;
}

const TYPE_CHECK: Record<ParamSpec['type'], (v: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
};

/** Why one parameter value breaks its spec, or null when it fits. */
function paramError(name: string, spec: ParamSpec, v: unknown): string | null {
  if (!TYPE_CHECK[spec.type](v)) return `parameter "${name}" must be a ${spec.type}`;
  if (spec.values && !spec.values.includes(v as string)) return `parameter "${name}" must be one of ${spec.values.join(', ')}`;
  const n = v as number;
  if ((spec.min !== undefined && n < spec.min) || (spec.max !== undefined && n > spec.max)) return `parameter "${name}" must be within ${spec.min}..${spec.max}`;
  return null;
}

/** Why `params` do not fit `cap`'s parameters (unknown, missing, mistyped, out of range), or null. */
export function validateParams(cap: Capability, params: Params): string | null {
  const unknown = Object.keys(params).find((k) => !Object.hasOwn(cap.params, k));
  if (unknown) return `unknown parameter "${unknown}" for "${cap.id}"`;
  for (const [name, spec] of Object.entries(cap.params)) {
    const v = params[name];
    if (v === undefined || v === null) {
      if (spec.required) return `missing parameter "${name}" for "${cap.id}"`;
      continue;
    }
    const error = paramError(name, spec, v);
    if (error) return error;
  }
  return null;
}

/** One capability as a compact prompt line: `id(name:type?, …) — description [flags]`. */
export function capabilityLine(cap: Capability): string {
  const params = Object.entries(cap.params).map(([name, s]) => `${name}${s.required ? '' : '?'}:${s.values ? s.values.join('|') : s.type}`).join(',');
  const flags = [cap.realInput ? 'real input' : '', cap.readOnly ? 'read-only' : ''].filter(Boolean).join(', ');
  return `${cap.id}(${params}) — ${cap.description}${flags ? ` [${flags}]` : ''}`;
}

/** The compact capability list `requester` may invoke, one line each. */
export const capabilityPrompt = (caps: readonly Capability[], requester: Requester) => caps.filter((c) => !permission(c, requester)).map(capabilityLine).join('\n');

export interface Registry {
  list: readonly Capability[];
  get: (id: string) => Capability | undefined;
  /** Validates, permission-checks, runs and logs one request; never rejects. */
  invoke: (id: string, params: Params, requester: Requester) => Promise<InvocationRecord>;
}

/** A registry over `caps`; every invocation, refused or run, is passed to `record`. */
export function createRegistry(caps: readonly Capability[], record: (r: InvocationRecord) => void): Registry {
  const byId = new Map(caps.map((c) => [c.id, c]));
  const run = async (cap: Capability | undefined, id: string, params: Params, requester: Requester): Promise<{ ok: boolean; result: string }> => {
    if (!cap) return { ok: false, result: `unknown capability "${id}"` };
    const refusal = permission(cap, requester) ?? validateParams(cap, params);
    if (refusal) return { ok: false, result: refusal };
    try {
      return { ok: true, result: await cap.invoke(params, requester) };
    } catch (error) {
      return { ok: false, result: error instanceof Error ? error.message : String(error) };
    }
  };
  return {
    list: caps,
    get: (id) => byId.get(id),
    invoke: async (id, params, requester) => {
      const outcome = await run(byId.get(id), id, params, requester);
      const entry: InvocationRecord = { time: Date.now(), requester: requesterName(requester), id, params, ...outcome };
      record(entry);
      return entry;
    },
  };
}

/** The settings the main AI may adjust mid-run, with their validated ranges. */
export const LIVE_SETTINGS = {
  captureMs: { type: 'number', description: 'capture cadence (ms)', min: RANGES.captureMs[0], max: RANGES.captureMs[1] },
  watchMs: { type: 'number', description: 'screen watcher cadence (ms)', min: RANGES.watchMs[0], max: RANGES.watchMs[1] },
  stepRetries: { type: 'number', description: 'retries per step', min: RANGES.stepRetries[0], max: RANGES.stepRetries[1] },
  maxIterations: { type: 'number', description: 'auto-continue rounds', min: RANGES.maxIterations[0], max: RANGES.maxIterations[1] },
  avoidTtlHours: { type: 'number', description: 'blacklist rule lifetime (hours)', min: RANGES.avoidTtlHours[0], max: RANGES.avoidTtlHours[1] },
  monitorMode: { type: 'string', description: 'monitor mode', values: MODES },
  aiView: { type: 'string', description: 'view resolution sent to the AI', values: Object.keys(AI_VIEWS) as AiView[] },
} as const satisfies Record<string, ParamSpec>;

export type LiveSetting = keyof typeof LIVE_SETTINGS;

/** The values a live adjustment may set, by key. */
type LiveValue = { [K in LiveSetting]: K extends 'monitorMode' ? MonitorMode : K extends 'aiView' ? AiView : number };

/** The settings with one live adjustment applied, or why it is rejected (unknown key, wrong type, out of range — never clamped). */
export function applyLiveSetting(settings: AssistSettings, key: string, value: unknown): { ok: true; settings: AssistSettings; message: string } | { ok: false; message: string } {
  if (!Object.hasOwn(LIVE_SETTINGS, key)) return { ok: false, message: `"${key}" is not a live setting (${Object.keys(LIVE_SETTINGS).join(', ')})` };
  const live = key as LiveSetting;
  const error = paramError(live, LIVE_SETTINGS[live], value);
  if (error) return { ok: false, message: error };
  const next = { ...settings, [live]: value as LiveValue[typeof live] };
  return { ok: true, settings: next, message: `${live}: ${String(settings[live])} → ${String(value)}` };
}
