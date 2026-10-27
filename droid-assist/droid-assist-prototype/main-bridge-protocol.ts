/**
 * Wire contract between Droid Assist and the main Droid app: typed JSON envelopes over a WebSocket
 * (path WS_PATH, token as `?token=`), with an HTTP fallback (GET EVENTS_PATH?after=<cursor> →
 * `{ success, events, cursor }`, POST COMMANDS_PATH with one envelope; token as a bearer header).
 * Frames are JPEG data URLs. In listen mode the assist app hosts the same paths in reverse
 * (POST EVENTS_PATH, GET COMMANDS_PATH?after=<cursor>).
 */
export const PROTOCOL_VERSION = 1;
export const WS_PATH = '/assist-bridge';
export const EVENTS_PATH = '/api/assist-bridge/events';
export const COMMANDS_PATH = '/api/assist-bridge/commands';

/** The intercepts the main app raises. */
export type InterceptKind = 'element_moved' | 'error_occurred' | 'test_requested';
export const INTERCEPT_KINDS: readonly InterceptKind[] = ['element_moved', 'error_occurred', 'test_requested'];

/** A point on the main app's preview, normalized 0..1. */
export interface WireElement {
  name: string;
  x: number;
  y: number;
}

export interface HelloPayload {
  app: string;
}

/** One preview frame: a JPEG data URL and its native size. */
export interface FramePayload {
  image: string;
  width: number;
  height: number;
}

export interface InterceptPayload {
  kind: InterceptKind;
  message: string;
  /** element_moved: the element at its new position. */
  element?: WireElement;
  /** test_requested: the test spec, one route/link per line (subagents.parseTestSpec). */
  test?: string;
}

/** The main app's answer to a command (`replyTo` names the command). */
export interface ResultPayload {
  ok: boolean;
  message: string;
}

/** One input step for the main app to perform on its preview, coordinates normalized 0..1. */
export interface RunScriptPayload {
  name: string;
  action: string;
  x: number;
  y: number;
  endX?: number;
  endY?: number;
  text?: string;
  target?: string;
}

export interface ReportStatePayload {
  source: string;
  armed: boolean;
  running: boolean;
  goal: string;
  steps: number;
}

export type RequestFramePayload = Record<string, never>;

export interface InterceptNoticePayload {
  from: string;
  element: WireElement;
  note?: string;
}

/** Payload of every message the main app sends. */
export interface InboundPayloads {
  hello: HelloPayload;
  frame: FramePayload;
  intercept: InterceptPayload;
  result: ResultPayload;
}

/** Payload of every command the assist engine sends. */
export interface OutboundPayloads {
  hello: HelloPayload;
  run_script: RunScriptPayload;
  report_state: ReportStatePayload;
  request_frame: RequestFramePayload;
  intercept_notice: InterceptNoticePayload;
}

export interface Envelope<T extends string, P> {
  v: typeof PROTOCOL_VERSION;
  id: string;
  time: number;
  type: T;
  payload: P;
  replyTo?: string;
}

export type InboundType = keyof InboundPayloads;
export type OutboundType = keyof OutboundPayloads;
export type InboundMessage = { [K in InboundType]: Envelope<K, InboundPayloads[K]> }[InboundType];
export type OutboundMessage = { [K in OutboundType]: Envelope<K, OutboundPayloads[K]> }[OutboundType];

let seq = 0;

/** A new outbound envelope. */
export function envelope<K extends OutboundType>(type: K, payload: OutboundPayloads[K], replyTo?: string): Envelope<K, OutboundPayloads[K]> {
  seq += 1;
  return { v: PROTOCOL_VERSION, id: `da-${Date.now().toString(36)}-${seq}`, time: Date.now(), type, payload, ...(replyTo ? { replyTo } : {}) };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isElement = (v: unknown): v is WireElement => isObject(v) && typeof v.name === 'string' && isNum(v.x) && isNum(v.y);

/** Why an intercept payload is invalid, per kind; null when valid. */
const INTERCEPT_CHECKS: Record<InterceptKind, (p: Record<string, unknown>) => string | null> = {
  element_moved: (p) => (isElement(p.element) ? null : 'element_moved needs an element {name, x, y}'),
  error_occurred: () => null,
  test_requested: (p) => (typeof p.test === 'string' && p.test.trim() ? null : 'test_requested needs a test spec'),
};

/** Why an inbound payload is invalid, per type; null when valid. */
const INBOUND_CHECKS: Record<InboundType, (p: Record<string, unknown>) => string | null> = {
  hello: (p) => (typeof p.app === 'string' ? null : 'hello needs an app name'),
  frame: (p) => (typeof p.image === 'string' && p.image.startsWith('data:image/jpeg') ? (isNum(p.width) && isNum(p.height) ? null : 'frame needs width and height') : 'frame image must be a data:image/jpeg URL'),
  intercept: (p) => (INTERCEPT_KINDS.includes(p.kind as InterceptKind) && typeof p.message === 'string' ? INTERCEPT_CHECKS[p.kind as InterceptKind](p) : `unknown intercept kind "${String(p.kind)}"`),
  result: (p) => (typeof p.ok === 'boolean' && typeof p.message === 'string' ? null : 'result needs ok and message'),
};

export type Parsed = { ok: true; message: InboundMessage } | { ok: false; error: string };

/** Validates one inbound envelope (already JSON-decoded). */
export function validateInbound(raw: unknown): Parsed {
  if (!isObject(raw) || raw.v !== PROTOCOL_VERSION) return { ok: false, error: `not a v${PROTOCOL_VERSION} envelope` };
  if (typeof raw.id !== 'string' || typeof raw.type !== 'string' || !isObject(raw.payload)) return { ok: false, error: 'envelope needs id, type and payload' };
  const check = INBOUND_CHECKS[raw.type as InboundType];
  if (!check) return { ok: false, error: `unknown message type "${raw.type}"` };
  const problem = check(raw.payload);
  return problem ? { ok: false, error: problem } : { ok: true, message: { ...raw, time: isNum(raw.time) ? raw.time : Date.now() } as InboundMessage };
}

/** Decodes and validates one inbound text message. */
export function parseInbound(text: string): Parsed {
  try {
    return validateInbound(JSON.parse(text));
  } catch {
    return { ok: false, error: 'message is not JSON' };
  }
}
