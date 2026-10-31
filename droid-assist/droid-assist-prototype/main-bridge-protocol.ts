/**
 * Wire contract between Droid Assist and the main Droid app: typed JSON envelopes over a WebSocket
 * (path WS_PATH, token as `?token=`), with an HTTP fallback (GET EVENTS_PATH?after=<cursor> →
 * `{ success, events, cursor }`, POST COMMANDS_PATH with one envelope; token as a bearer header).
 * Frames are JPEG data URLs. In listen mode the assist app hosts the same paths in reverse
 * (POST EVENTS_PATH, GET COMMANDS_PATH?after=<cursor>).
 */
export const PROTOCOL_VERSION = 2;
export const WS_PATH = '/assist-bridge';
export const EVENTS_PATH = '/api/assist-bridge/events';
export const COMMANDS_PATH = '/api/assist-bridge/commands';

/** The intercepts the main app raises. */
export type InterceptKind = 'element_moved' | 'error_occurred' | 'test_requested' | 'console_error';
export const INTERCEPT_KINDS: readonly InterceptKind[] = ['element_moved', 'error_occurred', 'test_requested', 'console_error'];

/** The two apps of the joint connection: droid-new (this assist app, the arbiter) and droid-main (the main Droid app). */
export type JointApp = 'droid-new' | 'droid-main';
export const JOINT_APPS: readonly JointApp[] = ['droid-new', 'droid-main'];

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
  /** console_error / error_occurred: the code file the error points at, when known. */
  file?: string;
}

/** The main app's current load (0..1) and the joint capabilities it can take on. */
export interface StatusPayload {
  load: number;
  capabilities: string[];
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

/** Which half of a joint operation the receiving app does. */
export type JointRole = 'calculate' | 'perform';

/** droid-new (arbiter) hands one half of a joint operation to droid-main, with the reasoning of the choice. */
export interface JointRequestPayload {
  operation: string;
  role: JointRole;
  goal: string;
  reason: string;
}

/** An approved code-file fix for droid-main to apply. */
export interface CodeFixPayload {
  file: string;
  problem: string;
  fix: string;
  approvalId: string;
}

/** The two apps of a takeover: droid-new (this app, the boss) and droid-main. */
export type TakeoverSide = 'droid-new' | 'droid-main';

/**
 * A step handed to droid-main with its full context, so it continues the run rather than restarting:
 * the goal, the step and every step after it, screenshots, what was tried and why it failed.
 */
export interface TakeoverRequestPayload {
  runId: string;
  goal: string;
  /** 0-based index of the handed-over step; droid-main resumes here. */
  stepIndex: number;
  step: RunScriptPayload;
  /** The handed-over step and every step after it, in order. */
  remaining: RunScriptPayload[];
  /** JPEG data URLs, oldest first: the latest screens of the step. */
  screenshots: string[];
  /** One line per attempt made on the step. */
  tried: string[];
  reason: string;
  /** The handoff in words, for droid-main's AI. */
  note: string;
}

/** Per-step report of droid-new's verification, for droid-main's Assist page and its AI. */
export interface StepReportPayload {
  runId: string;
  stepIndex: number;
  name: string;
  verified: boolean;
  message: string;
}

/** One side's agents' verdict on a step: the background agent-to-agent exchange of every step. */
export interface AgentVotePayload {
  runId: string;
  stepIndex: number;
  side: TakeoverSide;
  agree: boolean;
  /** The agents that voted. */
  agents: string[];
  note: string;
}

/** droid-main detected a step incomplete and takes it over. */
export interface TakeoverClaimPayload {
  runId: string;
  stepIndex: number;
  reason: string;
}

/** How droid-main's takeover of a step ended. */
export interface TakeoverResultPayload {
  runId: string;
  stepIndex: number;
  ok: boolean;
  message: string;
}

/** v2: the main app asks droid-new to analyze its screen (an optional question about it). */
export interface AnalyzePayload {
  question?: string;
}

/** v2: plan a workflow for `goal` without running it. */
export interface PlanWorkflowPayload {
  goal: string;
}

/** v2: run a workflow — plans `goal` first when given, then replays the plan. */
export interface RunWorkflowPayload {
  goal?: string;
  selfTest?: boolean;
}

/** v2: verify the current run's goal (or `goal`). */
export interface VerifyPayload {
  goal?: string;
}

/** v2: start or stop watching (pointing out) the screen. */
export interface WatchPayload {
  on: boolean;
  target?: string;
}

/** v2: an error the other app hit while assisting. */
export interface AssistErrorPayload {
  message: string;
  goal?: string;
}

/** v2: a user request typed in one app, carried to the other. */
export interface UserRequestPayload {
  text: string;
  from: string;
}

/** v2: one step handed over to the other app with its full context. */
export interface TakeoverPayload {
  reason: string;
  goal: string;
  index: number;
  step: string;
  steps: string[];
  log: string[];
}

/** v2: what one app tells the other to do with its run. */
export type RegulateCommand = 'pause' | 'stop' | 'resume' | 'arm' | 'disarm' | 'mode';
export const REGULATE_COMMANDS: readonly RegulateCommand[] = ['pause', 'stop', 'resume', 'arm', 'disarm', 'mode'];

export interface RegulatePayload {
  command: RegulateCommand;
  /** mode: the execution mode to switch to. */
  mode?: string;
  reason?: string;
}

/** v2: one side's agents' opinion of whether a step is complete. */
export interface StepOpinionPayload {
  index: number;
  step: string;
  agree: boolean;
  note?: string;
  element?: WireElement;
}

/** v2: one browser console line of an app. */
/** Severity of a forwarded console line. */
export type ConsoleLevel = 'error' | 'warn' | 'info';
/** Every console level, in severity order. */
export const CONSOLE_LEVELS: readonly ConsoleLevel[] = ['error', 'warn', 'info'];

/** A console line droid-main forwards so droid-new's agents can detect and fix it. */
export interface ConsoleLogPayload {
  app: string;
  level: ConsoleLevel;
  message: string;
}

/** v2: one app's live state (runs in progress, agent activity). */
export interface AppStatePayload {
  app: string;
  running: boolean;
  goal: string;
  steps: number;
  activeIndex: number;
  agentsBusy: number;
}

/** The v2 messages both apps send each other. */
export interface PeerPayloads {
  user_request: UserRequestPayload;
  takeover: TakeoverPayload;
  regulate: RegulatePayload;
  step_opinion: StepOpinionPayload;
  console_log: ConsoleLogPayload;
  app_state: AppStatePayload;
}

/** The v2 requests the main app sends; each is answered with a `result` replying to it. */
export interface RequestPayloads {
  analyze: AnalyzePayload;
  plan_workflow: PlanWorkflowPayload;
  run_workflow: RunWorkflowPayload;
  verify: VerifyPayload;
  watch: WatchPayload;
  assist_error: AssistErrorPayload;
}

export type RequestType = keyof RequestPayloads;
export type PeerType = keyof PeerPayloads;

/** Payload of every message the main app sends. */
export interface InboundPayloads extends RequestPayloads, PeerPayloads {
  hello: HelloPayload;
  frame: FramePayload;
  intercept: InterceptPayload;
  result: ResultPayload;
  status: StatusPayload;
  takeover_claim: TakeoverClaimPayload;
  takeover_result: TakeoverResultPayload;
  agent_vote: AgentVotePayload;
}

/** Payload of every command the assist engine sends. */
export interface OutboundPayloads extends PeerPayloads {
  hello: HelloPayload;
  run_script: RunScriptPayload;
  report_state: ReportStatePayload;
  request_frame: RequestFramePayload;
  intercept_notice: InterceptNoticePayload;
  joint_request: JointRequestPayload;
  code_fix: CodeFixPayload;
  takeover_request: TakeoverRequestPayload;
  step_report: StepReportPayload;
  agent_vote: AgentVotePayload;
  result: ResultPayload;
}

/** The protocol versions accepted inbound. */
export type ProtocolVersion = 1 | 2;
export const ACCEPTED_VERSIONS: readonly ProtocolVersion[] = [1, PROTOCOL_VERSION];

/** v1 commands keep going out as v1 so v1 peers still read them; everything else is v2. */
const V1_OUTBOUND: ReadonlySet<string> = new Set(['hello', 'run_script', 'report_state', 'request_frame', 'intercept_notice']);

/** The envelope version an outbound type goes out as. */
export const versionOf = (type: OutboundType): ProtocolVersion => (V1_OUTBOUND.has(type) ? 1 : PROTOCOL_VERSION);

export interface Envelope<T extends string, P> {
  v: ProtocolVersion;
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
  return { v: versionOf(type), id: `da-${Date.now().toString(36)}-${seq}`, time: Date.now(), type, payload, ...(replyTo ? { replyTo } : {}) };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isElement = (v: unknown): v is WireElement => isObject(v) && typeof v.name === 'string' && isNum(v.x) && isNum(v.y);
const isText = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
const optString = (v: unknown) => v === undefined || typeof v === 'string';
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

/** Why an intercept payload is invalid, per kind; null when valid. */
const INTERCEPT_CHECKS: Record<InterceptKind, (p: Record<string, unknown> & { message: string }) => string | null> = {
  element_moved: (p) => (isElement(p.element) ? null : 'element_moved needs an element {name, x, y}'),
  error_occurred: () => null,
  test_requested: (p) => (typeof p.test === 'string' && p.test.trim() ? null : 'test_requested needs a test spec'),
  console_error: (p) => (p.message.trim() ? null : 'console_error needs the console message'),
};

const isLoad = (v: unknown) => isNum(v) && v >= 0 && v <= 1;
const isNames = (v: unknown) => Array.isArray(v) && v.every((c) => typeof c === 'string');
/** Why a takeover payload's run/step reference is invalid; null when valid. */
const stepRef = (type: string, p: Record<string, unknown>) => (typeof p.runId === 'string' && isNum(p.stepIndex) && p.stepIndex >= 0 ? null : `${type} needs runId and stepIndex`);

/** Why an inbound payload is invalid, per type; null when valid. */
const INBOUND_CHECKS: Record<InboundType, (p: Record<string, unknown>) => string | null> = {
  hello: (p) => (typeof p.app === 'string' ? null : 'hello needs an app name'),
  frame: (p) => (typeof p.image === 'string' && p.image.startsWith('data:image/jpeg') ? (isNum(p.width) && isNum(p.height) ? null : 'frame needs width and height') : 'frame image must be a data:image/jpeg URL'),
  intercept: (p) => (INTERCEPT_KINDS.includes(p.kind as InterceptKind) && typeof p.message === 'string' ? INTERCEPT_CHECKS[p.kind as InterceptKind](p as Record<string, unknown> & { message: string }) : `unknown intercept kind "${String(p.kind)}"`),
  result: (p) => (typeof p.ok === 'boolean' && typeof p.message === 'string' ? null : 'result needs ok and message'),
  status: (p) => (isLoad(p.load) && isNames(p.capabilities) ? null : 'status needs load 0..1 and a capabilities list'),
  takeover_claim: (p) => stepRef('takeover_claim', p) ?? (typeof p.reason === 'string' ? null : 'takeover_claim needs a reason'),
  takeover_result: (p) => stepRef('takeover_result', p) ?? (typeof p.ok === 'boolean' && typeof p.message === 'string' ? null : 'takeover_result needs ok and message'),
  agent_vote: (p) => stepRef('agent_vote', p) ?? (p.side === 'droid-main' && typeof p.agree === 'boolean' ? null : 'agent_vote needs side "droid-main" and agree'),
  analyze: (p) => (optString(p.question) ? null : 'analyze question must be text'),
  plan_workflow: (p) => (isText(p.goal) ? null : 'plan_workflow needs a goal'),
  run_workflow: (p) => (optString(p.goal) && (p.selfTest === undefined || typeof p.selfTest === 'boolean') ? null : 'run_workflow goal must be text'),
  verify: (p) => (optString(p.goal) ? null : 'verify goal must be text'),
  watch: (p) => (typeof p.on === 'boolean' && optString(p.target) ? null : 'watch needs on'),
  assist_error: (p) => (isText(p.message) && optString(p.goal) ? null : 'assist_error needs a message'),
  user_request: (p) => (isText(p.text) && typeof p.from === 'string' ? null : 'user_request needs text and from'),
  takeover: (p) =>
    typeof p.goal === 'string' && typeof p.step === 'string' && isNum(p.index) && typeof p.reason === 'string' && isStrings(p.steps) && isStrings(p.log) ? null : 'takeover needs reason, goal, index, step, steps and log',
  regulate: (p) => (REGULATE_COMMANDS.includes(p.command as RegulateCommand) ? (p.command !== 'mode' || isText(p.mode) ? null : 'regulate mode needs a mode') : `unknown regulate command "${String(p.command)}"`),
  step_opinion: (p) => (isNum(p.index) && typeof p.step === 'string' && typeof p.agree === 'boolean' && (p.element === undefined || isElement(p.element)) ? null : 'step_opinion needs index, step and agree'),
  console_log: (p) => (typeof p.app === 'string' && CONSOLE_LEVELS.includes(p.level as ConsoleLevel) && typeof p.message === 'string' ? null : 'console_log needs app, level and message'),
  app_state: (p) => (typeof p.app === 'string' && typeof p.running === 'boolean' && typeof p.goal === 'string' && isNum(p.steps) && isNum(p.activeIndex) && isNum(p.agentsBusy) ? null : 'app_state needs app, running, goal, steps, activeIndex and agentsBusy'),
};

const REQUEST_TYPES: Record<RequestType, true> = { analyze: true, plan_workflow: true, run_workflow: true, verify: true, watch: true, assist_error: true };
/** True for the v2 requests that are answered with a `result`. */
export const isRequest = (m: InboundMessage): m is Extract<InboundMessage, { type: RequestType }> => m.type in REQUEST_TYPES;

export type Parsed = { ok: true; message: InboundMessage } | { ok: false; error: string };

/** Validates one inbound envelope (already JSON-decoded); v1 and v2 envelopes are both accepted. */
export function validateInbound(raw: unknown): Parsed {
  if (!isObject(raw) || !ACCEPTED_VERSIONS.includes(raw.v as ProtocolVersion)) return { ok: false, error: `not a v${ACCEPTED_VERSIONS.join('/v')} envelope` };
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
