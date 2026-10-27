import type { StageId } from './loop-control.js';
import { stageOff } from './loop-control.js';
import { parseJsonReply, type AskFn } from './ai.js';

/** The JSON type a capability parameter takes. */
export type ParamType = 'string' | 'number' | 'boolean' | 'array' | 'object';

/** One declared parameter of a capability. */
export interface ParamSpec {
  name: string;
  type: ParamType;
  required: boolean;
  description: string;
}

/** Who invokes a capability: the main AI, the user (panel), or a background agent with its loop-control stage. */
export type Caller = { kind: 'main' } | { kind: 'user' } | { kind: 'agent'; stage: StageId };

/** What an invocation reports: success, one line for the log, and any data it produced. */
export interface CapabilityResult {
  ok: boolean;
  message: string;
  data?: unknown;
}

/** Parameters as given by the caller (parsed JSON). */
export type Params = Record<string, unknown>;

/** One registered capability: its id, declared parameters, who may invoke it and the operation itself. */
export interface Capability {
  id: string;
  description: string;
  params: ParamSpec[];
  /** 'all': main AI, user and agents; 'main': main AI and user only (never an agent). */
  access: 'all' | 'main';
  invoke: (params: Params, caller: Caller) => Promise<CapabilityResult>;
}

/** Every capability by id. */
export type Registry = ReadonlyMap<string, Capability>;

/** A registry of `caps`; throws on a duplicate id. */
export function createRegistry(caps: Capability[]): Registry {
  const reg = new Map<string, Capability>();
  for (const cap of caps) {
    if (reg.has(cap.id)) throw new Error(`Capability "${cap.id}" is registered twice`);
    reg.set(cap.id, cap);
  }
  return reg;
}

const TYPE_OF: Record<ParamType, (v: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  object: (v) => !!v && typeof v === 'object' && !Array.isArray(v),
};

/** Why `params` do not fit the declared parameters (missing required, wrong type, unknown name), or null. */
export function paramError(cap: Capability, params: Params): string | null {
  const unknown = Object.keys(params).find((k) => !cap.params.some((p) => p.name === k));
  if (unknown) return `unknown parameter "${unknown}"`;
  for (const p of cap.params) {
    const v = params[p.name];
    if (v === undefined) {
      if (p.required) return `missing required parameter "${p.name}"`;
    } else if (!TYPE_OF[p.type](v)) return `parameter "${p.name}" must be ${p.type}`;
  }
  return null;
}

/**
 * The permission check: an agent may invoke only 'all' capabilities and only while its own
 * loop-control stage is on. The main AI and the user may invoke every capability.
 */
export function permissionError(cap: Capability, caller: Caller, stageOn: (id: StageId) => boolean): string | null {
  if (caller.kind !== 'agent') return null;
  if (cap.access === 'main') return `"${cap.id}" may be invoked only by the main AI or the user, not by an agent`;
  return stageOn(caller.stage) ? null : stageOff(caller.stage);
}

/** Invokes `id` for `caller` after the permission and parameter checks; a refusal or a throw is a failed result, never a success. */
export async function invokeCapability(reg: Registry, caller: Caller, id: string, params: Params, stageOn: (id: StageId) => boolean): Promise<CapabilityResult> {
  const cap = reg.get(id);
  if (!cap) return { ok: false, message: `Unknown capability "${id}" — known: ${[...reg.keys()].join(', ')}` };
  const refusal = permissionError(cap, caller, stageOn) ?? paramError(cap, params);
  if (refusal) return { ok: false, message: `${id} refused — ${refusal}` };
  try {
    return await cap.invoke(params, caller);
  } catch (error) {
    return { ok: false, message: `${id} failed — ${error instanceof Error ? error.message : String(error)}` };
  }
}

const paramLine = (p: ParamSpec) => `${p.name}${p.required ? '' : '?'}: ${p.type} — ${p.description}`;

/** The registry as text for the main AI: one block per capability with its parameters. */
export function catalogText(reg: Registry): string {
  return [...reg.values()].map((c) => [`${c.id}${c.access === 'main' ? ' (main only)' : ''}: ${c.description}`, ...c.params.map((p) => `  - ${paramLine(p)}`)].join('\n')).join('\n');
}

/** A parsed /do target: a direct invocation, a free-text request for the AI to resolve, or an error. */
export type DoRequest = { kind: 'direct'; id: string; params: Params } | { kind: 'ask'; request: string } | { kind: 'error'; message: string };

const ID_RE = /^([a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+)(?:\s+([\s\S]*))?$/;

/** "<id> {json}" or "<id>" is direct when `id` is registered; anything else is a request for the AI. */
export function parseDoRequest(text: string, reg: Registry): DoRequest {
  const m = ID_RE.exec(text.trim());
  if (!m || !reg.has(m[1])) return { kind: 'ask', request: text.trim() };
  const rest = (m[2] ?? '').trim();
  if (!rest) return { kind: 'direct', id: m[1], params: {} };
  try {
    const params: unknown = JSON.parse(rest);
    if (TYPE_OF.object(params)) return { kind: 'direct', id: m[1], params: params as Params };
  } catch {
    // reported below
  }
  return { kind: 'error', message: `/do ${m[1]}: parameters must be one JSON object, got ${rest}` };
}

/** The system prompt the main AI resolves a free-text request with. */
const doSystem = (catalog: string) => `You are Droid Assist's main AI. Choose ONE registered capability that performs the user's request and its parameters. Capabilities:\n${catalog}\nReply ONLY with JSON {"capability":string,"params":object}.`;

/** Asks the main AI which capability (and parameters) performs `request`; throws when the reply names none. */
export async function askCapability(ask: AskFn, reg: Registry, request: string): Promise<{ id: string; params: Params }> {
  const { content } = await ask({ system: doSystem(catalogText(reg)), prompt: request, json: true });
  const r = parseJsonReply(content);
  const id = typeof r.capability === 'string' ? r.capability.trim() : '';
  if (!id) throw new Error('AI reply named no capability');
  return { id, params: TYPE_OF.object(r.params) ? (r.params as Params) : {} };
}
