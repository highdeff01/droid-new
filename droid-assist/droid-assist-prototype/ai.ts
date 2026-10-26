import type { Frame } from './types.js';

/** The primary Ollama-compatible chat endpoint and its default model. */
export const DEFAULT_AI_URL = 'https://quantumclaw.net/ollama/api/chat';
export const DEFAULT_AI_MODEL = 'qwen3.5:2b';

/** Where the model is reached. */
export interface AiConfig {
  url: string;
  model: string;
}

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

/** Width/height of the JPEG the model sees (Frame.url). */
export const VIEW_W = 480;
export const VIEW_H = 270;
const HISTORY_KEY = 'droid-assist.ai-history';
const HISTORY_MAX = 20;

/** A model reply: its content plus the reasoning it returned (null when the response carried none). */
export interface AiReply {
  content: string;
  thinking: string | null;
}

/** message.thinking when it is a non-empty string; null otherwise (never invented). */
function thinkingOf(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/** A model call the user cancelled (AI stop, emergency stop): not an endpoint failure. */
export class AiCancelled extends AiError {
  override name = 'AiCancelled';
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
  const onAbort = () => stop(new AiCancelled('AI request cancelled by the user'));
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const done = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  };
  return { signal: ctrl.signal, cancelled, done };
}

/** The extra turn sent when the model spent its whole reply thinking and left message.content empty. */
export const CONTENT_RETRY_INSTRUCTION =
  'Your previous reply contained only thinking and an empty answer. Do not think further: put your final answer directly in the message content now.';
const CONTENT_RETRY_JSON = ' Reply with exactly one JSON object and nothing else.';

/** One POST on an already-combined signal; content is '' when the reply carried none. HTTP and network failures reject with AiError. */
async function post(cfg: AiConfig, messages: ChatMessage[], json: boolean, signal: AbortSignal): Promise<AiReply> {
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
 * aborting `signal` cancels the in-flight fetch and rejects at once with AiCancelled.
 * @param json ask the server for a JSON-formatted reply
 * @param signal cancels the call (AI stop / emergency stop), alongside the per-call timeout
 */
export async function chat(cfg: AiConfig, messages: ChatMessage[], json = false, timeoutMs = 90_000, signal?: AbortSignal): Promise<AiReply> {
  const call = cancellation(cfg.url, timeoutMs, signal);
  try {
    return await Promise.race([answer(cfg, messages, json, call.signal), call.cancelled]);
  } finally {
    call.done();
  }
}

/** chat()'s reply with the empty-content retry, on an already-combined signal. */
async function answer(cfg: AiConfig, messages: ChatMessage[], json: boolean, signal: AbortSignal): Promise<AiReply> {
  const first = await post(cfg, messages, json, signal);
  if (first.content) return first;
  if (!first.thinking) throw new AiError('AI endpoint returned no message content and no thinking');
  const instruction = `${CONTENT_RETRY_INSTRUCTION}${json ? CONTENT_RETRY_JSON : ''}`;
  const retry = await post(cfg, [...messages, { role: 'user', content: instruction }], json, signal);
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

/** The frame's display JPEG as bare base64, as Ollama's images[] expects. */
export function frameToBase64(frame: Frame): string {
  return frame.url.slice(frame.url.indexOf(',') + 1);
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
  system: string;
  prompt: string;
  frame?: Frame | null;
  /** Recent log / action lines sent as context. */
  context?: string[];
  json?: boolean;
  /** Cancels the call (AI stop / emergency stop). */
  signal?: AbortSignal;
}

/** The asker every AI feature goes through. */
export type AskFn = (req: AskRequest) => Promise<AiReply>;

/** Minimal storage the session persists history to (sessionStorage in the browser). */
export type HistoryStore = Pick<Storage, 'getItem' | 'setItem'>;

function loadHistory(store: HistoryStore | null): ChatMessage[] {
  try {
    const parsed = JSON.parse(store?.getItem(HISTORY_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

/** A signal aborted when either `a` (the session's cancel()) or `b` (the request's own signal) aborts. */
function eitherSignal(a: AbortSignal, b?: AbortSignal): AbortSignal {
  if (!b) return a;
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  for (const s of [a, b]) {
    if (s.aborted) abort();
    else s.addEventListener('abort', abort, { once: true });
  }
  return ctrl.signal;
}

/**
 * A per-session conversation: every ask sends system + history + the new user turn
 * (with the frame), and on success appends the text of both turns (content only, no thinking)
 * to the persisted history. `cancel()` aborts every request in flight (they reject with AiError).
 */
export function createAiSession(store: HistoryStore | null) {
  let history = loadHistory(store);
  let controller = new AbortController();
  const ask = async (cfg: AiConfig, req: AskRequest): Promise<AiReply> => {
    const context = req.context?.length ? `\n\nRecent activity (newest first):\n${req.context.join('\n')}` : '';
    const content = `${req.prompt}${context}`;
    const user: ChatMessage = { role: 'user', content, ...(req.frame ? { images: [frameToBase64(req.frame)] } : {}) };
    const reply = await chat(cfg, [{ role: 'system', content: req.system }, ...history, user], req.json, undefined, eitherSignal(controller.signal, req.signal));
    history = [...history, { role: 'user' as const, content }, { role: 'assistant' as const, content: reply.content }].slice(-HISTORY_MAX);
    store?.setItem(HISTORY_KEY, JSON.stringify(history));
    return reply;
  };
  const cancel = () => {
    controller.abort();
    controller = new AbortController();
  };
  return { ask, cancel, history: () => history };
}
