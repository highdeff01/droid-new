import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { DEFAULT_AI_URL, LOCAL_AI_PROXY_URL, PING_MESSAGE } from './ai.js';

/**
 * The optional local AI proxy: the app posts its Ollama /api/chat body to LOCAL_AI_PROXY_URL on its
 * own origin and the proxy forwards it unchanged to the quantumclaw Qwen endpoint, so the browser
 * never makes a cross-origin call. The health-check ping is answered locally without a model call.
 */

/** How long one upstream model call may take before the proxy answers 504. */
export const PROXY_TIMEOUT_MS = 60_000;
/** Largest request body accepted (screenshots travel base64 in images[]). */
const BODY_LIMIT = '50mb';

/** Where the proxy forwards to and how. */
export interface AiProxyOptions {
  upstream: string;
  timeoutMs: number;
  fetchFn: typeof fetch;
}

/** The ping's reply, in the Ollama /api/chat shape the app reads. */
export const PING_REPLY = { message: { role: 'assistant', content: 'OK', thinking: null } };

/** True for the app's health check: exactly one user message saying PING_MESSAGE. */
export function isPing(body: unknown): boolean {
  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages) || messages.length !== 1) return false;
  const m = messages[0] as { role?: unknown; content?: unknown } | null;
  return m?.role === 'user' && m.content === PING_MESSAGE;
}

/** CORS headers on every response, and a 204 for preflight, so a cross-origin page may call the proxy too. */
function cors(req: Request, res: Response, next: NextFunction) {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
}

/** The upstream call's outcome as the proxy's status and JSON body: upstream status and body, 504 on timeout, 502 when unreachable. */
async function forward(body: unknown, { upstream, timeoutMs, fetchFn }: AiProxyOptions): Promise<{ status: number; json: unknown }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetchFn(upstream, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: abort.signal });
    const text = await res.text();
    return { status: res.status, json: parseOr(text, res.ok ? {} : { error: text || `upstream HTTP ${res.status}` }) };
  } catch (error) {
    if (abort.signal.aborted) return { status: 504, json: { error: `AI upstream timed out after ${timeoutMs / 1000} s` } };
    return { status: 502, json: { error: `AI upstream unreachable: ${error instanceof Error ? error.message : String(error)}` } };
  } finally {
    clearTimeout(timer);
  }
}

const parseOr = (text: string, fallback: unknown): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

/** Proxy options from the environment: DROID_AI_UPSTREAM or the quantumclaw Qwen endpoint. */
export const proxyOptionsFromEnv = (env: NodeJS.ProcessEnv): AiProxyOptions => ({ upstream: env.DROID_AI_UPSTREAM || DEFAULT_AI_URL, timeoutMs: PROXY_TIMEOUT_MS, fetchFn: fetch });

/** An Express app serving the AI proxy at LOCAL_AI_PROXY_URL. */
export function createAiProxy(options: AiProxyOptions): Express {
  const app = express();
  app.use(LOCAL_AI_PROXY_URL, cors, express.json({ limit: BODY_LIMIT }));
  app.post(LOCAL_AI_PROXY_URL, async (req, res) => {
    if (isPing(req.body)) {
      res.json(PING_REPLY);
      return;
    }
    const { status, json } = await forward(req.body, options);
    res.status(status).json(json);
  });
  return app;
}
