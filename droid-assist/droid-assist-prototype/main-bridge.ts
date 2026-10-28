import { bridgeHeaders } from './bridge.js';
import type { ListenOptions, MainBridgeNativeApi } from './electron/main-bridge-api.js';
import { COMMANDS_PATH, EVENTS_PATH, WS_PATH, envelope, parseInbound, type InboundMessage, type OutboundPayloads, type OutboundType, type ResultPayload } from './main-bridge-protocol.js';

declare global {
  interface Window {
    /** Exposed by the Electron preload: the listener the main Droid app connects to. Undefined in a plain browser. */
    droidMainBridge?: MainBridgeNativeApi;
  }
}

/** Off (disabled), waiting for the main app (listen), dialing it, connected, or failed (with lastError). */
export type MainBridgeStatus = 'off' | 'waiting' | 'connecting' | 'connected' | 'error';
export type MainBridgeMode = 'listen' | 'dial';

export interface MainBridgeConfig {
  enabled: boolean;
  mode: MainBridgeMode;
  /** Listen mode: the interface and port the main app connects to. */
  host: string;
  port: number;
  /** Dial mode: the main app's base URL (http(s):// or ws(s)://). */
  url: string;
  /** Optional shared secret; never logged. */
  token: string;
  backoffMinMs: number;
  backoffMaxMs: number;
}

export interface MainBridgeState {
  status: MainBridgeStatus;
  lastError: string | null;
  /** Who is connected (transport and address) while connected. */
  peer: string | null;
}

export type LogTone = 'info' | 'ok' | 'warn' | 'error';

export interface MainBridgeEvents {
  onState(state: MainBridgeState): void;
  /** One validated envelope from the main app (results are delivered too, after resolving their request). */
  onMessage(message: InboundMessage): void;
  onLog(message: string, tone: LogTone): void;
}

type SocketCtor = new (url: string) => WebSocket;

export interface MainBridgeDeps {
  WebSocket?: SocketCtor;
  fetch: typeof fetch;
  native?: MainBridgeNativeApi;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface SendResult {
  ok: boolean;
  message: string;
  id?: string;
}

export interface MainBridge {
  start(): void;
  stop(): void;
  state(): MainBridgeState;
  /** Sends one command; a plain failure when not connected. Never throws. */
  send<K extends OutboundType>(type: K, payload: OutboundPayloads[K], replyTo?: string): Promise<SendResult>;
  /** Sends one command and waits for the main app's `result` envelope replying to it. Never throws. */
  request<K extends OutboundType>(type: K, payload: OutboundPayloads[K], timeoutMs?: number): Promise<ResultPayload>;
}

export const NOT_CONNECTED = 'Main app not connected — command not sent';
export const LISTEN_NEEDS_DESKTOP = 'Listen mode needs the Droid Assist desktop app — in a browser, switch the main app bridge to dial mode and set the main app URL';
export const DIAL_NEEDS_URL = 'Dial mode needs the main app URL — set it in Settings › Main app bridge';

/** True in a plain browser build: no Electron preload exposed the main-bridge listener. */
export const inBrowser = () => typeof window !== 'undefined' && !window.droidMainBridge;

/** The bridge mode a fresh install starts in: dial in a browser (listen cannot work there), listen on the desktop. */
export const defaultBridgeMode = (): 'listen' | 'dial' => (inBrowser() ? 'dial' : 'listen');
export const POLL_MS = 500;
export const REQUEST_TIMEOUT_MS = 30000;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const httpBase = (url: string) => url.trim().replace(/\/$/, '').replace(/^ws(s?):\/\//i, 'http$1://');

/** The WebSocket URL of a main-app base URL; the token rides as `?token=` (browsers cannot set WS headers). */
export function socketUrl(url: string, token: string): string {
  const ws = httpBase(url).replace(/^http(s?):\/\//i, 'ws$1://');
  return `${ws}${WS_PATH}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

/** Reconnect delay of the n-th consecutive failure: min, doubling, capped at max. */
export function backoffDelay(attempt: number, minMs: number, maxMs: number): number {
  return Math.min(maxMs, minMs * 2 ** Math.min(attempt, 20));
}

/** What a transport reports to the manager. */
interface Sink {
  open(peer: string): void;
  message(text: string): void;
  close(reason: string): void;
  fail(message: string): void;
}

interface Transport {
  send(text: string): Promise<boolean>;
  close(): void;
}

function openSocket(url: string, token: string, sink: Sink, Ctor: SocketCtor): Transport {
  const ws = new Ctor(socketUrl(url, token));
  let opened = false;
  ws.onopen = () => {
    opened = true;
    sink.open(`WebSocket ${httpBase(url)}`);
  };
  ws.onmessage = (event) => sink.message(String(event.data));
  ws.onclose = (event) => (opened ? sink.close(event.reason || `socket closed (code ${event.code})`) : sink.fail(`WebSocket to ${httpBase(url)} failed`));
  return {
    send: async (text) => {
      if (ws.readyState !== 1) return false;
      ws.send(text);
      return true;
    },
    close: () => {
      ws.onclose = null;
      ws.close();
    },
  };
}

const httpProblem = (res: Response) => (res.status === 401 || res.status === 403 ? 'unauthorized — check the main app bridge token' : `HTTP ${res.status}`);

function openPolling(url: string, token: string, sink: Sink, deps: MainBridgeDeps): Transport {
  const base = httpBase(url);
  let cursor = '';
  let opened = false;
  let stopped = false;
  let timer: unknown;
  const lost = (error: unknown) => {
    if (stopped) return;
    stopped = true;
    if (opened) sink.close(`HTTP fallback lost: ${errorText(error)}`);
    else sink.fail(`HTTP fallback to ${base} failed: ${errorText(error)}`);
  };
  const tick = async () => {
    try {
      const res = await deps.fetch(`${base}${EVENTS_PATH}?after=${encodeURIComponent(cursor)}`, { headers: bridgeHeaders(token) });
      if (stopped) return;
      if (!res.ok) throw new Error(httpProblem(res));
      const body = (await res.json()) as { events?: unknown[]; cursor?: unknown };
      if (!opened) {
        opened = true;
        sink.open(`HTTP ${base}`);
      }
      for (const event of body.events ?? []) sink.message(JSON.stringify(event));
      if (body.cursor !== undefined) cursor = String(body.cursor);
      if (!stopped) timer = deps.setTimeout(() => void tick(), POLL_MS);
    } catch (error) {
      lost(error);
    }
  };
  void tick();
  return {
    send: async (text) => {
      const res = await deps.fetch(`${base}${COMMANDS_PATH}`, { method: 'POST', headers: bridgeHeaders(token, true), body: text });
      return res.ok;
    },
    close: () => {
      stopped = true;
      deps.clearTimeout(timer);
    },
  };
}

function openListener(native: MainBridgeNativeApi, options: ListenOptions, sink: Sink): Transport {
  native.listen(options, { onOpen: sink.open, onMessage: sink.message, onClose: sink.close, onError: sink.fail }).catch((error) => sink.fail(errorText(error)));
  return { send: (text) => native.send(text), close: () => native.stop() };
}

/** The real globals, read at call time so tests can stub them. */
export function defaultDeps(): MainBridgeDeps {
  return {
    WebSocket: typeof WebSocket === 'undefined' ? undefined : WebSocket,
    fetch: (...args) => globalThis.fetch(...args),
    native: typeof window === 'undefined' ? undefined : window.droidMainBridge,
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

/**
 * The connection manager of the main-app bridge: listens for the main Droid app (Electron listener)
 * or dials it (WebSocket, falling back to HTTP polling), reconnects with backoff, validates every
 * inbound envelope and pairs `result` replies with the commands they answer.
 */
export function createMainBridge(config: MainBridgeConfig, events: MainBridgeEvents, deps: MainBridgeDeps = defaultDeps()): MainBridge {
  let current: MainBridgeState = { status: 'off', lastError: null, peer: null };
  let transport: Transport | null = null;
  let generation = 0;
  let attempt = 0;
  let retry: unknown;
  const pending = new Map<string, (result: ResultPayload) => void>();

  const set = (patch: Partial<MainBridgeState>) => {
    current = { ...current, ...patch };
    events.onState(current);
  };
  const settleAll = (message: string) => {
    for (const resolve of pending.values()) resolve({ ok: false, message });
    pending.clear();
  };
  const drop = () => {
    transport?.close();
    transport = null;
  };

  const receive = (text: string) => {
    const parsed = parseInbound(text);
    if (!parsed.ok) return events.onLog(`Ignored a message from the main app: ${parsed.error}`, 'warn');
    const { message } = parsed;
    if (message.type === 'result' && message.replyTo) {
      pending.get(message.replyTo)?.(message.payload);
      pending.delete(message.replyTo);
    }
    events.onMessage(message);
  };

  const retryLater = (reason: string) => {
    // One failure may be reported twice (listener onError and the rejected listen()); retiring the
    // session's generation drops the duplicate, and only one retry timer is ever pending.
    generation += 1;
    deps.clearTimeout(retry);
    drop();
    settleAll(reason);
    const delay = backoffDelay(attempt++, config.backoffMinMs, config.backoffMaxMs);
    set({ status: 'error', lastError: reason, peer: null });
    events.onLog(`Main app bridge error — ${reason}; retrying in ${(delay / 1000).toFixed(1)} s`, 'error');
    retry = deps.setTimeout(connect, delay);
  };

  const sink = (gen: number, fail: (message: string) => void): Sink => {
    const live = () => gen === generation;
    return {
      open: (peer) => {
        if (!live()) return;
        attempt = 0;
        set({ status: 'connected', lastError: null, peer });
        events.onLog(`Main app connected (${peer})`, 'ok');
      },
      message: (text) => { if (live()) receive(text); },
      close: (reason) => {
        if (!live()) return;
        settleAll(`Main app disconnected — ${reason}`);
        events.onLog(`Main app disconnected — ${reason}`, 'warn');
        if (config.mode === 'listen') set({ status: 'waiting', peer: null });
        else retryLater(`disconnected — ${reason}`);
      },
      fail: (message) => { if (live()) fail(message); },
    };
  };

  const listen = (gen: number) => {
    if (!deps.native) {
      set({ status: 'error', lastError: LISTEN_NEEDS_DESKTOP, peer: null });
      return events.onLog(`Main app bridge error — ${LISTEN_NEEDS_DESKTOP}`, 'error');
    }
    set({ status: 'waiting', peer: null });
    events.onLog(`Waiting for the main app on ${config.host}:${config.port}`, 'info');
    transport = openListener(deps.native, { host: config.host, port: config.port, token: config.token }, sink(gen, retryLater));
  };

  const dial = (gen: number) => {
    if (!config.url.trim()) {
      set({ status: 'error', lastError: DIAL_NEEDS_URL, peer: null });
      return events.onLog(`Main app bridge error — ${DIAL_NEEDS_URL}`, 'error');
    }
    set({ status: 'connecting', peer: null });
    events.onLog(`Dialing the main app at ${httpBase(config.url)}`, 'info');
    const poll = () => { transport = openPolling(config.url, config.token, sink(gen, retryLater), deps); };
    if (!deps.WebSocket) return poll();
    transport = openSocket(config.url, config.token, sink(gen, (message) => {
      events.onLog(`${message} — trying the HTTP fallback`, 'warn');
      poll();
    }), deps.WebSocket);
  };

  function connect() {
    drop();
    generation += 1;
    if (config.mode === 'listen') listen(generation);
    else dial(generation);
  }

  const send = async <K extends OutboundType>(type: K, payload: OutboundPayloads[K], replyTo?: string): Promise<SendResult> => {
    if (current.status !== 'connected' || !transport) return { ok: false, message: NOT_CONNECTED };
    const env = envelope(type, payload, replyTo);
    try {
      const sent = await transport.send(JSON.stringify(env));
      events.onLog(sent ? `Sent ${type} to the main app` : `Could not send ${type} — the main app is not reachable`, sent ? 'info' : 'warn');
      return sent ? { ok: true, message: `Sent ${type}`, id: env.id } : { ok: false, message: NOT_CONNECTED };
    } catch (error) {
      events.onLog(`Could not send ${type}: ${errorText(error)}`, 'warn');
      return { ok: false, message: `Could not send ${type}: ${errorText(error)}` };
    }
  };

  const request = async <K extends OutboundType>(type: K, payload: OutboundPayloads[K], timeoutMs = REQUEST_TIMEOUT_MS): Promise<ResultPayload> => {
    const sent = await send(type, payload);
    if (!sent.ok || !sent.id) return { ok: false, message: sent.message };
    const id = sent.id;
    return new Promise<ResultPayload>((resolve) => {
      const timer = deps.setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, message: `The main app did not answer ${type} within ${Math.round(timeoutMs / 1000)} s; its effect is uncertain` });
      }, timeoutMs);
      pending.set(id, (result) => {
        deps.clearTimeout(timer);
        resolve(result);
      });
    });
  };

  return {
    start: () => {
      if (!config.enabled) return set({ status: 'off', lastError: null, peer: null });
      connect();
    },
    stop: () => {
      generation += 1;
      deps.clearTimeout(retry);
      drop();
      settleAll('Main app bridge stopped');
      if (current.status !== 'off') events.onLog('Main app bridge stopped', 'info');
      set({ status: 'off', peer: null });
    },
    state: () => current,
    send,
    request,
  };
}
