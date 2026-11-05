import http from 'node:http';
import type { Duplex } from 'node:stream';
import { COMMANDS_PATH, EVENTS_PATH, WS_PATH } from '../main-bridge-protocol.js';
import type { ListenHandlers, ListenOptions } from './main-bridge-api.js';
import { OPCODES, createFrameReader, encodeFrame, handshakeResponse } from './ws-codec.js';

/** An HTTP-fallback peer counts as gone once it has not polled for this long. */
export const HTTP_IDLE_MS = 5000;
/** Commands kept for an HTTP-fallback peer that has not fetched them yet. */
export const QUEUE_LIMIT = 200;
const BODY_LIMIT = 16 * 1024 * 1024;

export interface MainBridgeListener {
  /** Resolves once the port is bound; rejects with the reason otherwise. */
  ready: Promise<void>;
  /** Sends one text message to the connected main app; false when none is connected. */
  send(text: string): boolean;
  stop(): void;
}

/** Whether a request carries the token (bearer header or `?token=`); anything goes when no token is set. */
function authorized(req: http.IncomingMessage, url: URL, token: string): boolean {
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}` || url.searchParams.get('token') === token;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) reject(new Error('body too large'));
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function reply(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

/**
 * Listens on host:port for the main Droid app: a WebSocket at WS_PATH, or the HTTP fallback
 * (POST EVENTS_PATH with one envelope or an array, GET COMMANDS_PATH?after=<cursor>). One peer at a time;
 * a new WebSocket replaces the previous one.
 */
export function startMainBridgeListener(options: ListenOptions, handlers: ListenHandlers): MainBridgeListener {
  let socket: Duplex | null = null;
  let httpPeer: string | null = null;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  let queue: Array<{ seq: number; text: string }> = [];

  const closeSocket = (reason: string) => {
    const s = socket;
    if (!s) return;
    socket = null;
    s.destroy();
    handlers.onClose(reason);
  };
  const dropHttpPeer = () => {
    if (!httpPeer) return;
    httpPeer = null;
    queue = [];
    handlers.onClose('the main app stopped polling');
  };
  const touchHttpPeer = (address: string) => {
    clearTimeout(idle);
    idle = setTimeout(dropHttpPeer, HTTP_IDLE_MS);
    if (httpPeer || socket) return;
    httpPeer = `HTTP ${address}`;
    handlers.onOpen(httpPeer);
  };

  const onEvents = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const body = JSON.parse(await readBody(req)) as unknown;
    touchHttpPeer(req.socket.remoteAddress ?? 'unknown');
    for (const event of Array.isArray(body) ? body : [body]) handlers.onMessage(JSON.stringify(event));
    reply(res, 200, { success: true });
  };
  const onCommands = (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => {
    touchHttpPeer(req.socket.remoteAddress ?? 'unknown');
    const after = Number(url.searchParams.get('after') || 0);
    reply(res, 200, { success: true, events: queue.filter((c) => c.seq > after).map((c) => JSON.parse(c.text) as unknown), cursor: String(seq) });
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://listener');
    if (!authorized(req, url, options.token)) return reply(res, 401, { success: false, error: 'unauthorized' });
    if (req.method === 'POST' && url.pathname === EVENTS_PATH) return void onEvents(req, res).catch((error: Error) => reply(res, 400, { success: false, error: error.message }));
    if (req.method === 'GET' && url.pathname === COMMANDS_PATH) return onCommands(req, res, url);
    reply(res, 404, { success: false, error: 'not found' });
  });

  server.on('upgrade', (req: http.IncomingMessage, s: Duplex) => {
    const url = new URL(req.url ?? '/', 'http://listener');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== WS_PATH || typeof key !== 'string' || !authorized(req, url, options.token)) {
      s.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    closeSocket('replaced by a new connection');
    s.write(handshakeResponse(key));
    socket = s;
    const read = createFrameReader((opcode, payload) => {
      if (opcode === OPCODES.text) handlers.onMessage(payload.toString('utf8'));
      else if (opcode === OPCODES.ping) s.write(encodeFrame(OPCODES.pong, payload));
      else if (opcode === OPCODES.close) {
        s.write(encodeFrame(OPCODES.close, Buffer.alloc(0)));
        if (socket === s) closeSocket('the main app closed the connection');
      }
    });
    s.on('data', read);
    s.on('close', () => { if (socket === s) closeSocket('connection lost'); });
    s.on('error', () => { if (socket === s) closeSocket('connection error'); });
    handlers.onOpen(`WebSocket ${req.socket.remoteAddress ?? 'unknown'}`);
  });

  const ready = new Promise<void>((resolve, reject) => {
    server.once('error', (error: Error) => {
      handlers.onError(`Main app bridge listener failed on ${options.host}:${options.port}: ${error.message}`);
      reject(error);
    });
    server.listen(options.port, options.host, () => resolve());
  });

  return {
    ready,
    send: (text) => {
      if (socket) {
        socket.write(encodeFrame(OPCODES.text, Buffer.from(text, 'utf8')));
        return true;
      }
      if (!httpPeer) return false;
      seq += 1;
      queue = [...queue, { seq, text }].slice(-QUEUE_LIMIT);
      return true;
    },
    stop: () => {
      clearTimeout(idle);
      socket?.destroy();
      socket = null;
      httpPeer = null;
      server.close();
    },
  };
}
