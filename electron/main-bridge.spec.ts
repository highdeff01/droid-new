// @vitest-environment node
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMANDS_PATH, EVENTS_PATH, WS_PATH } from '../main-bridge-protocol.js';
import type { ListenHandlers } from './main-bridge-api.js';
import { startMainBridgeListener, type MainBridgeListener } from './main-bridge-server.js';
import { OPCODES, acceptKey, createFrameReader, decodeFrame, encodeFrame } from './ws-codec.js';

const HOST = '127.0.0.1';
const randomPort = () => 40000 + Math.floor(Math.random() * 20000);

function noopHandlers(): ListenHandlers {
  return { onOpen: vi.fn(), onMessage: vi.fn(), onClose: vi.fn(), onError: vi.fn() };
}

/** A promise that resolves with the arguments of the next call; use in place of a handler stub. */
function once<T extends unknown[]>(): [Promise<T>, (...args: T) => void] {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return [promise, (...args: T) => resolve(args)];
}

interface WsTestClient {
  socket: net.Socket;
  status: string;
  headers: Record<string, string>;
  key: string;
  sendText(text: string): void;
  next(): Promise<{ opcode: number; payload: Buffer } | null>;
}

/** A minimal raw WebSocket client over node:net, for exercising the listener's handshake and framing. */
function wsClient(host: string, port: number, pathAndQuery: string): Promise<WsTestClient> {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString('base64');
    const socket = net.createConnection(port, host, () => {
      const request = [
        `GET ${pathAndQuery} HTTP/1.1`,
        `Host: ${host}:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n');
      socket.write(request);
    });
    socket.on('error', reject);

    let buffered = Buffer.alloc(0);
    let headerParsed = false;
    const frameQueue: Array<{ opcode: number; payload: Buffer }> = [];
    const waiters: Array<(f: { opcode: number; payload: Buffer } | null) => void> = [];
    const deliverFrame = (opcode: number, payload: Buffer) => {
      const waiter = waiters.shift();
      if (waiter) waiter({ opcode, payload });
      else frameQueue.push({ opcode, payload });
    };
    const read = createFrameReader(deliverFrame);

    socket.on('data', (chunk: Buffer) => {
      if (headerParsed) {
        read(chunk);
        return;
      }
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf('\r\n\r\n');
      if (end === -1) return;
      const [statusLine, ...headerLines] = buffered.subarray(0, end).toString('utf8').split('\r\n');
      const headers: Record<string, string> = {};
      for (const line of headerLines) {
        const sep = line.indexOf(':');
        if (sep !== -1) headers[line.slice(0, sep).trim().toLowerCase()] = line.slice(sep + 1).trim();
      }
      headerParsed = true;
      resolve({
        socket,
        status: statusLine,
        headers,
        key,
        sendText: (text: string) => socket.write(encodeFrame(OPCODES.text, Buffer.from(text, 'utf8'), randomBytes(4))),
        next: () => new Promise((res) => (frameQueue.length ? res(frameQueue.shift()!) : waiters.push(res))),
      });
      const rest = buffered.subarray(end + 4);
      if (rest.length) read(rest);
    });
  });
}

describe('CODEC', () => {
  it('computes the RFC 6455 example accept key', () => {
    expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });

  it('round-trips a short text payload', () => {
    const decoded = decodeFrame(encodeFrame(OPCODES.text, Buffer.from('hi')));
    expect(decoded?.frame.fin).toBe(true);
    expect(decoded?.frame.opcode).toBe(OPCODES.text);
    expect(decoded?.frame.payload.toString('utf8')).toBe('hi');
    expect(decoded?.rest.length).toBe(0);
  });

  it('round-trips a 300-byte payload using the 16-bit length form', () => {
    const payload = Buffer.from('x'.repeat(300));
    const decoded = decodeFrame(encodeFrame(OPCODES.binary, payload));
    expect(decoded?.frame.payload.equals(payload)).toBe(true);
  });

  it('round-trips a masked payload', () => {
    const payload = Buffer.from('masked payload');
    const decoded = decodeFrame(encodeFrame(OPCODES.text, payload, Buffer.from([1, 2, 3, 4])));
    expect(decoded?.frame.payload.toString('utf8')).toBe('masked payload');
  });

  it('returns null on partial input', () => {
    const encoded = encodeFrame(OPCODES.text, Buffer.from('hello world'));
    expect(decodeFrame(encoded.subarray(0, 1))).toBeNull();
  });

  it('joins a fin=false text frame with its continuation', () => {
    const received: Array<{ opcode: number; payload: Buffer }> = [];
    const read = createFrameReader((opcode, payload) => received.push({ opcode, payload }));
    const first = encodeFrame(OPCODES.text, Buffer.from('Hello, '));
    first[0] &= 0x7f;
    const second = encodeFrame(OPCODES.continuation, Buffer.from('world!'));
    read(Buffer.concat([first, second]));
    expect(received).toHaveLength(1);
    expect(received[0].opcode).toBe(OPCODES.text);
    expect(received[0].payload.toString('utf8')).toBe('Hello, world!');
  });

  it('joins a frame split across chunks', () => {
    const received: Buffer[] = [];
    const read = createFrameReader((_opcode, payload) => received.push(payload));
    const encoded = encodeFrame(OPCODES.text, Buffer.from('split across chunks'));
    read(encoded.subarray(0, 3));
    read(encoded.subarray(3));
    expect(received).toHaveLength(1);
    expect(received[0].toString('utf8')).toBe('split across chunks');
  });
});

describe('WEBSOCKET', () => {
  let listeners: MainBridgeListener[] = [];
  let sockets: net.Socket[] = [];

  afterEach(() => {
    for (const listener of listeners) listener.stop();
    listeners = [];
    for (const socket of sockets) socket.destroy();
    sockets = [];
  });

  function listen(token: string, port: number, handlers: ListenHandlers = noopHandlers()): MainBridgeListener {
    const listener = startMainBridgeListener({ host: HOST, port, token }, handlers);
    listeners.push(listener);
    return listener;
  }

  async function connect(port: number, pathAndQuery: string): Promise<WsTestClient> {
    const client = await wsClient(HOST, port, pathAndQuery);
    sockets.push(client.socket);
    return client;
  }

  it('upgrades at WS_PATH with the token, replying with the matching accept key', async () => {
    const port = randomPort();
    const handlers = noopHandlers();
    await listen('t', port, handlers).ready;
    const client = await connect(port, `${WS_PATH}?token=t`);
    expect(client.status).toContain('101');
    expect(client.headers['sec-websocket-accept']).toBe(acceptKey(client.key));
    expect(handlers.onOpen).toHaveBeenCalledWith(expect.stringMatching(/^WebSocket/));
  });

  it('delivers a masked text frame to onMessage', async () => {
    const port = randomPort();
    const [onMessage, onMessageFn] = once<[string]>();
    await listen('', port, { ...noopHandlers(), onMessage: onMessageFn }).ready;
    const client = await connect(port, WS_PATH);
    client.sendText('{"hello":"world"}');
    await expect(onMessage).resolves.toEqual(['{"hello":"world"}']);
  });

  it('writes an unmasked frame via listener.send that the client decodes', async () => {
    const port = randomPort();
    const listener = listen('', port);
    await listener.ready;
    const client = await connect(port, WS_PATH);
    expect(listener.send('{"type":"hello"}')).toBe(true);
    const frame = await client.next();
    expect(frame?.payload.toString('utf8')).toBe('{"type":"hello"}');
  });

  it('rejects an upgrade with the wrong token with 401 and no onOpen', async () => {
    const port = randomPort();
    const handlers = noopHandlers();
    await listen('t', port, handlers).ready;
    const client = await connect(port, `${WS_PATH}?token=wrong`);
    expect(client.status).toContain('401');
    expect(handlers.onOpen).not.toHaveBeenCalled();
  });

  it('rejects an upgrade at the wrong path with 401 and no onOpen', async () => {
    const port = randomPort();
    const handlers = noopHandlers();
    await listen('t', port, handlers).ready;
    const client = await connect(port, `/not-the-bridge?token=t`);
    expect(client.status).toContain('401');
    expect(handlers.onOpen).not.toHaveBeenCalled();
  });

  it('calls onClose when the client sends a close frame', async () => {
    const port = randomPort();
    const [onClose, onCloseFn] = once<[string]>();
    await listen('', port, { ...noopHandlers(), onClose: onCloseFn }).ready;
    const client = await connect(port, WS_PATH);
    client.socket.write(encodeFrame(OPCODES.close, Buffer.alloc(0), randomBytes(4)));
    await expect(onClose).resolves.toBeDefined();
  });

  it('send returns false when no peer is connected', async () => {
    const port = randomPort();
    const listener = listen('', port);
    await listener.ready;
    expect(listener.send('hi')).toBe(false);
  });
});

describe('HTTP FALLBACK', () => {
  let listeners: MainBridgeListener[] = [];

  afterEach(() => {
    for (const listener of listeners) listener.stop();
    listeners = [];
  });

  function listen(token: string, port: number, handlers: ListenHandlers = noopHandlers()): MainBridgeListener {
    const listener = startMainBridgeListener({ host: HOST, port, token }, handlers);
    listeners.push(listener);
    return listener;
  }

  it('accepts a POST to EVENTS_PATH with a bearer token, opening an HTTP peer', async () => {
    const port = randomPort();
    const [onOpen, onOpenFn] = once<[string]>();
    const [onMessage, onMessageFn] = once<[string]>();
    await listen('t', port, { ...noopHandlers(), onOpen: onOpenFn, onMessage: onMessageFn }).ready;
    const envelope = { v: 1, id: 'x', time: 1, type: 'hello', payload: { app: 'droid' } };
    const res = await fetch(`http://${HOST}:${port}${EVENTS_PATH}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    await expect(onOpen).resolves.toEqual([expect.stringMatching(/^HTTP/)]);
    const [message] = await onMessage;
    expect(JSON.parse(message)).toEqual(envelope);
  });

  it('delivers each envelope of a POSTed array', async () => {
    const port = randomPort();
    const messages: string[] = [];
    await listen('', port, { ...noopHandlers(), onMessage: (text) => messages.push(text) }).ready;
    const envelopes = [
      { v: 1, id: 'a', time: 1, type: 'hello', payload: { app: 'x' } },
      { v: 1, id: 'b', time: 2, type: 'hello', payload: { app: 'y' } },
    ];
    const res = await fetch(`http://${HOST}:${port}${EVENTS_PATH}`, { method: 'POST', body: JSON.stringify(envelopes) });
    expect(res.status).toBe(200);
    expect(messages.map((m) => JSON.parse(m))).toEqual(envelopes);
  });

  it('rejects a POST without a token with 401', async () => {
    const port = randomPort();
    await listen('t', port).ready;
    const res = await fetch(`http://${HOST}:${port}${EVENTS_PATH}`, { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(401);
  });

  it('queues a sent command for an HTTP peer and serves it via GET COMMANDS_PATH', async () => {
    const port = randomPort();
    const listener = listen('', port);
    await listener.ready;
    await fetch(`http://${HOST}:${port}${EVENTS_PATH}`, { method: 'POST', body: JSON.stringify({ v: 1, id: 'a', time: 1, type: 'hello', payload: { app: 'x' } }) });
    const command = { v: 1, id: 'c', time: 1, type: 'run_script', payload: {} };
    expect(listener.send(JSON.stringify(command))).toBe(true);
    const after0 = await fetch(`http://${HOST}:${port}${COMMANDS_PATH}?after=0`);
    expect(await after0.json()).toEqual({ success: true, events: [command], cursor: '1' });
    const after1 = await fetch(`http://${HOST}:${port}${COMMANDS_PATH}?after=1`);
    expect(await after1.json()).toEqual({ success: true, events: [], cursor: '1' });
  });

  it('rejects ready and calls onError when the port is already in use', async () => {
    const port = randomPort();
    const first = listen('', port);
    await first.ready;
    const handlers = noopHandlers();
    const second = listen('', port, handlers);
    await expect(second.ready).rejects.toThrow();
    expect(handlers.onError).toHaveBeenCalled();
  });
});
