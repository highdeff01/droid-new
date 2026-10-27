import type { Frame } from './types.js';
import { HISTORY_MAX, STALE_KEEP, STALE_PARSE_LIMIT, trimHistory, type HistoryChange, type HistoryEntry, type TrimReason } from './ai-history.js';

/** The primary Ollama-compatible chat endpoint and its default model. */
export const DEFAULT_AI_URL = 'https://quantumclaw.net/ollama/api/chat';
export const DEFAULT_AI_MODEL = 'qwen3.5:2b';

/** Where the model is reached, and the pixel size screenshots are sent to it at. */
export interface AiConfig {
  url: string;
  model: string;
  /** Size each screenshot is rendered at for the model; absent means SAMPLE_VIEW. */
  view?: ViewSize;
  /** Per-request timeout in ms; absent means DEFAULT_AI_TIMEOUT_MS. */
  timeoutMs?: number;
}

/** Default per-request AI timeout, and the Settings range it is validated against. */
export const DEFAULT_AI_TIMEOUT_MS = 90_000;
export const AI_TIMEOUT_MS_MIN = 10_000;
export const AI_TIMEOUT_MS_MAX = 300_000;

/** Live reachability of the model endpoint. */
export interface AiStatus {
  state: 'checking' | 'online' | 'offline';
  detail: string;
}

/** One Ollama /api/chat message; `images` carries base64 frames without a data: prefix. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

/** Any failure to get a usable model reply. Never replaced by a canned answer. */
export class AiError extends Error {
  override name = 'AiError';
}

/** Width/height of the sample space: Frame.url, the UI, the bridge and the drift math. */
export const VIEW_W = 480;
export const VIEW_H = 270;
const HISTORY_KEY = 'droid-assist.ai-history';

/** Pixel size of an image sent to the model. */
export interface ViewSize {
  w: number;
  h: number;
}

/** The AI view resolutions Settings offers. */
export type AiView = '480x270' | '960x540' | '1280x720';
export const AI_VIEWS: Record<AiView, ViewSize> = {
  '480x270': { w: 480, h: 270 },
  '960x540': { w: 960, h: 540 },
  '1280x720': { w: 1280, h: 720 },
};
export const DEFAULT_AI_VIEW: AiView = '960x540';
/** The sample-space view: what a frame's display JPEG is, and how a reply without a view is read. */
export const SAMPLE_VIEW: ViewSize = { w: VIEW_W, h: VIEW_H };

/** A system prompt, fixed or written for the view the screenshots are sent at. */
export type SystemPrompt = string | ((view: ViewSize) => string);

/** The text of `system` for screenshots sent at `view`. */
export const systemText = (system: SystemPrompt, view: ViewSize) => (typeof system === 'string' ? system : system(view));

/** A model reply: its content plus the reasoning it returned (null when the response carried none). */
export interface AiReply {
  content: string;
  thinking: string | null;
  /** Pixel size the screenshots of this request were sent at; absent means SAMPLE_VIEW. */
  view?: ViewSize;
}

/** Pixel coordinates of `view` read back as a point in the 0..1 sample space. */
export function viewPoint(x: unknown, y: unknown, view: ViewSize = SAMPLE_VIEW): { x: number; y: number } {
  return { x: toUnit(x, view.w), y: toUnit(y, view.h) };
}

/** message.thinking when it is a non-empty string; null otherwise (never invented). */
function thinkingOf(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/** The extra turn sent when the model spent its whole reply thinking and left message.content empty. */
export const CONTENT_RETRY_INSTRUCTION =
  'Your previous reply contained only thinking and an empty answer. Do not think further: put your final answer directly in the message content now.';
const CONTENT_RETRY_JSON = ' Reply with exactly one JSON object and nothing else.';

/** A model call the user cancelled (AI stop, emergency stop, a loop stage unchecked): not an endpoint failure. */
export class AiCancelled extends AiError {
  override name = 'AiCancelled';
}

/** A signal that aborts as soon as any of `signals` aborts. */
export function linkSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s?.aborted) ctrl.abort();
    else s?.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return ctrl.signal;
}

/**
 * One request's cancellation: its own AbortController, aborted by the timeout or by the
 * caller's `signal`; `cancelled` rejects at that moment so the call settles immediately.
 */
function cancellation(url: string, timeoutMs: number, signal?: AbortSignal) {
  const ctrl = new AbortController();
  let reject: (error: AiError) => void = () => undefined;
  const cancelled = new Promise<never>((_, r) => {
    reject = r;
  });
  cancelled.catch(() => undefined);
  const stop = (error: AiError) => {
    if (ctrl.signal.aborted) return;
    reject(error);
    ctrl.abort(error);
  };
  const timer = setTimeout(() => stop(new AiError(`AI endpoint unreachable (${url}): no reply within ${timeoutMs} ms`)), timeoutMs);
  const onAbort = () => stop(new AiCancelled('AI request cancelled'));
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const done = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  };
  return { signal: ctrl.signal, cancelled, done };
}

/** One POST, settling at once on timeout or cancel (AiCancelled); content is '' when the reply carried none. */
async function post(cfg: AiConfig, messages: ChatMessage[], json: boolean, timeoutMs: number, cancel?: AbortSignal): Promise<AiReply> {
  const call = cancellation(cfg.url, timeoutMs, cancel);
  try {
    return await Promise.race([fetchReply(cfg, messages, json, call.signal), call.cancelled]);
  } finally {
    call.done();
  }
}

/** The fetch and reply parsing of post(), on an already-combined signal. */
async function fetchReply(cfg: AiConfig, messages: ChatMessage[], json: boolean, signal: AbortSignal): Promise<AiReply> {
  let res: Response;
  try {
    res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, messages, stream: false, think: true, ...(json ? { format: 'json' } : {}) }),
      signal,
    });
  } catch (error) {
    throw new AiError(`AI endpoint unreachable (${cfg.url}): ${error instanceof Error ? error.message : String(error)}`);
  }
  const body = (await res.json().catch(() => null)) as { message?: { content?: unknown; thinking?: unknown }; error?: unknown } | null;
  if (!res.ok) throw new AiError(`AI endpoint HTTP ${res.status}${body?.error ? `: ${String(body.error)}` : ''}`);
  const content = body?.message?.content;
  return { content: typeof content === 'string' ? content.trim() : '', thinking: thinkingOf(body?.message?.thinking) };
}

/**
 * One non-streaming chat with thinking enabled; resolves with message.content and message.thinking.
 * A reply whose content is empty but whose thinking is not is retried once with an instruction to
 * answer in content; a still-empty answer, or one with neither content nor thinking, rejects with an
 * AiError naming the cause. HTTP errors, network errors and the timeout reject with AiError;
 * aborting `cancel` cancels the in-flight fetch and rejects at once with AiCancelled.
 * @param json ask the server for a JSON-formatted reply
 * @param cancel aborts the request (alongside the per-request timeout)
 */
export async function chat(cfg: AiConfig, messages: ChatMessage[], json = false, timeoutMs = DEFAULT_AI_TIMEOUT_MS, cancel?: AbortSignal): Promise<AiReply> {
  const first = await post(cfg, messages, json, timeoutMs, cancel);
  if (first.content) return first;
  if (!first.thinking) throw new AiError('AI endpoint returned no message content and no thinking');
  const instruction = `${CONTENT_RETRY_INSTRUCTION}${json ? CONTENT_RETRY_JSON : ''}`;
  const retry = await post(cfg, [...messages, { role: 'user', content: instruction }], json, timeoutMs, cancel);
  if (retry.content) return { content: retry.content, thinking: retry.thinking ?? first.thinking };
  throw new AiError('AI model spent its whole reply on thinking and returned no message content, even after a retry asking for the answer in content');
}

/** Startup / settings-change health check: a minimal chat against the configured URL and model. */
export async function pingAi(cfg: AiConfig): Promise<AiStatus> {
  try {
    await chat(cfg, [{ role: 'user', content: 'Reply with OK.' }], false, 20_000);
    return { state: 'online', detail: `Connected · ${cfg.model} @ ${new URL(cfg.url).host}` };
  } catch (error) {
    return { state: 'offline', detail: `AI unavailable — ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** A data URL as bare base64, as Ollama's images[] expects. */
const toBase64 = (url: string) => url.slice(url.indexOf(',') + 1);

/** The frame's display JPEG as bare base64, as Ollama's images[] expects. */
export function frameToBase64(frame: Frame): string {
  return toBase64(frame.url);
}

/** How much of an unparseable reply a parse failure keeps for the log. */
export const RAW_REPLY_MAX = 200;

/** A model reply that held no JSON object; `raw` is the reply truncated to RAW_REPLY_MAX for the log. */
export class AiParseError extends AiError {
  override name = 'AiParseError';
  constructor(readonly raw: string) {
    super('AI reply was not a JSON object (model returned prose)');
  }
}

/** The reply truncated to RAW_REPLY_MAX characters, marked with … when cut. */
export function truncateRaw(raw: string): string {
  const text = raw.trim();
  return text.length > RAW_REPLY_MAX ? `${text.slice(0, RAW_REPLY_MAX)}…` : text;
}

/** The reply without <think>…</think> blocks or stray think tags. */
export function stripThinking(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/g, '').trim();
}

/** Index of the '}' closing the '{' at `start` (string- and escape-aware), or -1. */
function closingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Every balanced {...} span, latest-ending first and outermost first on ties. */
function balancedSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (let i = text.indexOf('{'); i >= 0; i = text.indexOf('{', i + 1)) {
    const end = closingBrace(text, i);
    if (end > i) spans.push([i, end]);
  }
  return spans.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
}

function asObject(json: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Parses the LAST balanced JSON object in a model reply: <think> blocks, fences and any prose
 * around it are ignored. A reply with no JSON object throws AiParseError carrying the truncated raw reply.
 */
export function parseJsonReply(raw: string): Record<string, unknown> {
  const text = stripThinking(raw);
  for (const [start, end] of balancedSpans(text)) {
    const value = asObject(text.slice(start, end + 1));
    if (value) return value;
  }
  throw new AiParseError(truncateRaw(raw));
}

/**
 * A model coordinate as a 0..1 fraction: values above 1 are read as pixels of the
 * `size`-wide image the model saw. Throws AiError when it is not a number.
 */
export function toUnit(value: unknown, size: number): number {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new AiError(`AI gave a non-numeric coordinate: ${String(value)}`);
  return Math.min(1, Math.max(0, n > 1 ? n / size : n));
}

/** One question to the model about the current screen. */
export interface AskRequest {
  /** The reply contract; a function is resolved for the view the screenshots are sent at. */
  system: SystemPrompt;
  prompt: string;
  frame?: Frame | null;
  /** Further screenshots sent after `frame` (e.g. older gallery frames). */
  frames?: Frame[];
  /** Extra images sent after the frame as they are (e.g. a zoomed crop of the target region). */
  crops?: Frame[];
  /** Recent log / action lines sent as context. */
  context?: string[];
  /** The operation memory block (goal, objective, blacklist, failures); sent with this turn, never kept in the history. */
  memory?: string[];
  json?: boolean;
  /** Cancels the call (AI stop / emergency stop). */
  signal?: AbortSignal;
}

/** The asker every AI feature goes through. */
export type AskFn = (req: AskRequest) => Promise<AiReply>;

/** Draws a frame at `view` pixels for the model; resolves with a JPEG data URL. */
export type RenderFn = (frame: Frame, view: ViewSize) => Promise<string>;

/** Minimal storage the session persists history to (sessionStorage in the browser). */
export type HistoryStore = Pick<Storage, 'getItem' | 'setItem'>;

function loadHistory(store: HistoryStore | null): HistoryEntry[] {
  try {
    const parsed = JSON.parse(store?.getItem(HISTORY_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * The screenshots as sent and the view they were sent at: each rendered at `view` when a view and
 * a renderer are given; the frames' own display JPEGs in SAMPLE_VIEW otherwise, or when rendering fails.
 */
export async function screenshots(frames: Frame[], view: ViewSize | undefined, render: RenderFn | undefined): Promise<{ urls: string[]; view: ViewSize }> {
  const own = { urls: frames.map((f) => f.url), view: SAMPLE_VIEW };
  if (!view || !render) return own;
  try {
    return { urls: await Promise.all(frames.map((f) => render(f, view))), view };
  } catch {
    return own;
  }
}

/** Called with every trim or reset of a session's history. */
export type HistoryChangeFn = (change: HistoryChange) => void;

/**
 * A per-session conversation: every ask sends system + history + the new user turn
 * (with the frame rendered at cfg.view by `render`), and on success appends the text of both turns
 * (content only, no thinking) with their time to the persisted history, trimmed to HISTORY_MAX.
 * The reply carries the view its screenshots were sent at. `cancel()` aborts every request in
 * flight (they reject with AiError); `trim(n)` keeps the newest n messages; `reset()` cancels and
 * clears everything; `noteParse(ok)` feeds the stale-context guard, which trims to STALE_KEEP after
 * STALE_PARSE_LIMIT unparseable replies in a row. Every trim and reset is reported to `onChange`.
 */
export function createAiSession(store: HistoryStore | null, render?: RenderFn, onChange?: HistoryChangeFn) {
  let history = loadHistory(store);
  let controller = new AbortController();
  let parseFailures = 0;
  const shrink = (keep: number, reason: TrimReason) => {
    const before = history.length;
    history = trimHistory(history, keep);
    store?.setItem(HISTORY_KEY, JSON.stringify(history));
    onChange?.({ reason, before, after: history.length });
  };
  const ask = async (cfg: AiConfig, req: AskRequest): Promise<AiReply> => {
    const signal = linkSignals(controller.signal, req.signal);
    const context = req.context?.length ? `\n\nRecent activity (newest first):\n${req.context.join('\n')}` : '';
    const content = `${req.prompt}${context}`;
    const memory = req.memory?.length ? `\n\n${req.memory.join('\n')}` : '';
    const shots = await screenshots([...(req.frame ? [req.frame] : []), ...(req.frames ?? [])], cfg.view, render);
    const images = [...shots.urls, ...(req.crops ?? []).map((c) => c.url)].map(toBase64);
    const user: ChatMessage = { role: 'user', content: `${content}${memory}`, ...(images.length ? { images } : {}) };
    const system = systemText(req.system, shots.view);
    const turns = history.map(({ role, content: text }) => ({ role, content: text }));
    const reply = await chat(cfg, [{ role: 'system', content: system }, ...turns, user], req.json, cfg.timeoutMs, signal);
    const time = Date.now();
    history = [...history, { role: 'user' as const, content, time }, { role: 'assistant' as const, content: reply.content, time }];
    if (history.length > HISTORY_MAX) shrink(HISTORY_MAX, 'cap');
    else store?.setItem(HISTORY_KEY, JSON.stringify(history));
    return { ...reply, view: shots.view };
  };
  const cancel = () => {
    controller.abort();
    controller = new AbortController();
  };
  const trim = (keep: number) => shrink(keep, 'manual');
  const reset = () => {
    cancel();
    parseFailures = 0;
    shrink(0, 'reset');
  };
  const noteParse = (ok: boolean) => {
    parseFailures = ok ? 0 : parseFailures + 1;
    if (parseFailures < STALE_PARSE_LIMIT) return;
    parseFailures = 0;
    shrink(STALE_KEEP, 'stale');
  };
  return { ask, cancel, trim, reset, noteParse, history: () => history };
}
