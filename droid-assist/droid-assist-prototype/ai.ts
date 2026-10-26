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
  const onAbort = () => stop(new AiCancelled('AI call cancelled by the user'));
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const done = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  };
  return { signal: ctrl.signal, cancelled, done };
}

/**
 * One non-streaming POST to the chat endpoint with thinking enabled; resolves with
 * message.content and message.thinking.
 * HTTP errors, network errors, non-JSON bodies, empty replies and the timeout reject with AiError;
 * aborting `signal` cancels the in-flight fetch and rejects at once with AiCancelled.
 * @param json ask the server for a JSON-formatted reply
 */
export async function chat(cfg: AiConfig, messages: ChatMessage[], json = false, timeoutMs = 90_000, signal?: AbortSignal): Promise<AiReply> {
  const call = cancellation(cfg.url, timeoutMs, signal);
  try {
    return await Promise.race([post(cfg, messages, json, call.signal), call.cancelled]);
  } finally {
    call.done();
  }
}

/** The fetch and reply parsing of chat(), on an already-combined signal. */
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
  if (typeof content !== 'string' || !content.trim()) throw new AiError('AI endpoint returned no message content');
  return { content: content.trim(), thinking: thinkingOf(body?.message?.thinking) };
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

/** Parses a model reply as a JSON object, tolerating a ```json fence; throws AiError otherwise. */
export function parseJsonReply(raw: string): Record<string, unknown> {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AiError(`AI reply was not JSON: "${text.slice(0, 80)}"`);
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // reported below
  }
  throw new AiError(`AI reply was not a JSON object: "${text.slice(0, 80)}"`);
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

/**
 * A per-session conversation: every ask sends system + history + the new user turn
 * (with the frame), and on success appends the text of both turns (content only, no thinking)
 * to the persisted history.
 */
export function createAiSession(store: HistoryStore | null) {
  let history = loadHistory(store);
  const ask = async (cfg: AiConfig, req: AskRequest): Promise<AiReply> => {
    const context = req.context?.length ? `\n\nRecent activity (newest first):\n${req.context.join('\n')}` : '';
    const content = `${req.prompt}${context}`;
    const user: ChatMessage = { role: 'user', content, ...(req.frame ? { images: [frameToBase64(req.frame)] } : {}) };
    const reply = await chat(cfg, [{ role: 'system', content: req.system }, ...history, user], req.json, undefined, req.signal);
    history = [...history, { role: 'user' as const, content }, { role: 'assistant' as const, content: reply.content }].slice(-HISTORY_MAX);
    store?.setItem(HISTORY_KEY, JSON.stringify(history));
    return reply;
  };
  return { ask, history: () => history };
}
