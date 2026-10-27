import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backoffDelay,
  createMainBridge,
  DIAL_NEEDS_URL,
  LISTEN_NEEDS_DESKTOP,
  NOT_CONNECTED,
  type MainBridgeConfig,
  type MainBridgeDeps,
  type MainBridgeEvents,
  type MainBridgeState,
  type LogTone,
} from './main-bridge.js';
import { envelope, parseInbound, type InboundMessage } from './main-bridge-protocol.js';
import type { ListenHandlers, ListenOptions, MainBridgeNativeApi } from './electron/main-bridge-api.js';

// --- Shared fakes -----------------------------------------------------------

/** A fake WebSocket: records its url and itself, and exposes test-only open/emit/drop helpers. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  send(text: string): void {
    this.sent.push(text);
  }

  close(): void {
    this.readyState = 3;
  }

  /** Test helper: the peer accepted the connection. */
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  /** Test helper: one inbound text message arrives. */
  emit(text: string): void {
    this.onmessage?.({ data: text });
  }

  /** Test helper: the peer closed the socket. */
  drop(code: number, reason: string): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

/** A manually-driven timer list standing in for deps.setTimeout/clearTimeout. */
function manualTimers() {
  const timers: { fn: () => void; ms: number }[] = [];
  const setTimeoutFn = vi.fn((fn: () => void, ms: number): number => {
    timers.push({ fn, ms });
    return timers.length - 1;
  });
  const clearTimeoutFn = vi.fn((handle: unknown): void => {
    const i = handle as number;
    if (timers[i]) timers[i] = { fn: () => {}, ms: timers[i].ms };
  });
  return { timers, setTimeout: setTimeoutFn, clearTimeout: clearTimeoutFn, fire: (i: number) => timers[i]?.fn() };
}

/** A fake MainBridgeNativeApi whose captured listen handlers the test can drive directly. */
function fakeNative() {
  let handlers: ListenHandlers | undefined;
  const listen = vi.fn((_options: ListenOptions, h: ListenHandlers): Promise<void> => {
    handlers = h;
    return Promise.resolve();
  });
  const send = vi.fn((_text: string): Promise<boolean> => Promise.resolve(true));
  const stop = vi.fn();
  return {
    listen,
    send,
    stop,
    get handlers(): ListenHandlers | undefined {
      return handlers;
    },
  };
}

function fakeEvents() {
  const states: MainBridgeState[] = [];
  const messages: InboundMessage[] = [];
  const logs: { message: string; tone: LogTone }[] = [];
  const events: MainBridgeEvents = {
    onState: (s) => states.push(s),
    onMessage: (m) => messages.push(m),
    onLog: (message, tone) => logs.push({ message, tone }),
  };
  return { events, states, messages, logs };
}

const baseConfig = (): MainBridgeConfig => ({
  enabled: true,
  mode: 'listen',
  host: '0.0.0.0',
  port: 4555,
  url: '',
  token: '',
  backoffMinMs: 1000,
  backoffMaxMs: 8000,
});

const flushMicrotasks = () => new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

beforeEach(() => {
  FakeSocket.instances = [];
});

// --- PROTOCOL ----------------------------------------------------------------

describe('PROTOCOL', () => {
  describe('parseInbound', () => {
    it('accepts a valid frame with a JPEG data URL', () => {
      const text = JSON.stringify({ v: 1, id: 'f1', time: 1, type: 'frame', payload: { image: 'data:image/jpeg;base64,AA==', width: 10, height: 20 } });
      expect(parseInbound(text)).toMatchObject({ ok: true });
    });

    it.each([
      ['element_moved', { kind: 'element_moved', message: 'moved', element: { name: 'Btn', x: 0.1, y: 0.2 } }],
      ['error_occurred', { kind: 'error_occurred', message: 'oops' }],
      ['test_requested', { kind: 'test_requested', message: 'run it', test: '/home\n/settings' }],
    ] as const)('accepts a valid %s intercept', (_kind, payload) => {
      const text = JSON.stringify({ v: 1, id: 'i1', time: 1, type: 'intercept', payload });
      expect(parseInbound(text)).toMatchObject({ ok: true });
    });

    it('rejects a frame whose image is a PNG data URL', () => {
      const text = JSON.stringify({ v: 1, id: 'f2', time: 1, type: 'frame', payload: { image: 'data:image/png;base64,AA==', width: 10, height: 20 } });
      expect(parseInbound(text)).toMatchObject({ ok: false });
    });

    it('rejects text that is not JSON', () => {
      expect(parseInbound('not json at all')).toEqual({ ok: false, error: 'message is not JSON' });
    });

    it('rejects an envelope with the wrong protocol version', () => {
      const text = JSON.stringify({ v: 2, id: 'x', time: 1, type: 'hello', payload: { app: 'a' } });
      expect(parseInbound(text)).toMatchObject({ ok: false });
    });

    it('rejects an unknown message type', () => {
      const text = JSON.stringify({ v: 1, id: 'x', time: 1, type: 'bogus', payload: {} });
      expect(parseInbound(text)).toMatchObject({ ok: false });
    });

    it('rejects element_moved without an element', () => {
      const text = JSON.stringify({ v: 1, id: 'x', time: 1, type: 'intercept', payload: { kind: 'element_moved', message: 'moved' } });
      expect(parseInbound(text)).toMatchObject({ ok: false });
    });

    it('rejects test_requested without a test spec', () => {
      const text = JSON.stringify({ v: 1, id: 'x', time: 1, type: 'intercept', payload: { kind: 'test_requested', message: 'run it' } });
      expect(parseInbound(text)).toMatchObject({ ok: false });
    });
  });

  describe('envelope()', () => {
    it('builds a v1 envelope with id, time, type and payload, and no replyTo when none is given', () => {
      const env = envelope('request_frame', {});
      expect(env.v).toBe(1);
      expect(typeof env.id).toBe('string');
      expect(typeof env.time).toBe('number');
      expect(env.type).toBe('request_frame');
      expect(env.payload).toEqual({});
      expect(env).not.toHaveProperty('replyTo');
    });

    it('includes replyTo only when given', () => {
      const env = envelope('report_state', { source: 's', armed: true, running: false, goal: 'g', steps: 1 }, 'cmd-1');
      expect(env.replyTo).toBe('cmd-1');
    });
  });
});

// --- LIFECYCLE -----------------------------------------------------------------

describe('LIFECYCLE', () => {
  describe('backoffDelay', () => {
    it('doubles from the minimum on each attempt, capped at the maximum', () => {
      expect(backoffDelay(0, 1000, 8000)).toBe(1000);
      expect(backoffDelay(1, 1000, 8000)).toBe(2000);
      expect(backoffDelay(2, 1000, 8000)).toBe(4000);
      expect(backoffDelay(3, 1000, 8000)).toBe(8000);
      expect(backoffDelay(10, 1000, 8000)).toBe(8000);
    });
  });

  it('disabled: start sets status off without opening any transport', () => {
    const { events } = fakeEvents();
    const { setTimeout, clearTimeout } = manualTimers();
    const fetchSpy = vi.fn();
    const bridge = createMainBridge({ ...baseConfig(), enabled: false }, events, {
      WebSocket: FakeSocket as unknown as MainBridgeDeps['WebSocket'],
      fetch: fetchSpy,
      setTimeout,
      clearTimeout,
    });
    bridge.start();
    expect(bridge.state()).toEqual({ status: 'off', lastError: null, peer: null });
    expect(FakeSocket.instances).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('listen mode without the desktop native API reports LISTEN_NEEDS_DESKTOP', () => {
    const { events } = fakeEvents();
    const { setTimeout, clearTimeout } = manualTimers();
    const bridge = createMainBridge({ ...baseConfig(), mode: 'listen' }, events, { fetch: vi.fn(), setTimeout, clearTimeout });
    bridge.start();
    expect(bridge.state()).toEqual({ status: 'error', lastError: LISTEN_NEEDS_DESKTOP, peer: null });
  });

  it('listen mode with native: waits, then connects and returns to waiting on close', () => {
    const native = fakeNative();
    const { events } = fakeEvents();
    const { setTimeout, clearTimeout } = manualTimers();
    const config = { ...baseConfig(), mode: 'listen' as const, host: '1.2.3.4', port: 9000, token: 'tok' };
    const bridge = createMainBridge(config, events, { fetch: vi.fn(), native: native as unknown as MainBridgeNativeApi, setTimeout, clearTimeout });
    bridge.start();
    expect(bridge.state().status).toBe('waiting');
    expect(native.listen).toHaveBeenCalledWith({ host: '1.2.3.4', port: 9000, token: 'tok' }, expect.anything());
    native.handlers!.onOpen('peer-x');
    expect(bridge.state()).toEqual({ status: 'connected', lastError: null, peer: 'peer-x' });
    native.handlers!.onClose('bye');
    expect(bridge.state()).toEqual({ status: 'waiting', lastError: null, peer: null });
  });

  it('dial mode without a url reports DIAL_NEEDS_URL', () => {
    const { events } = fakeEvents();
    const { setTimeout, clearTimeout } = manualTimers();
    const bridge = createMainBridge({ ...baseConfig(), mode: 'dial', url: '' }, events, { fetch: vi.fn(), setTimeout, clearTimeout });
    bridge.start();
    expect(bridge.state()).toEqual({ status: 'error', lastError: DIAL_NEEDS_URL, peer: null });
  });

  it('dial mode opens a WebSocket to the assist-bridge path with the token, connecting on open', () => {
    const { events } = fakeEvents();
    const { setTimeout, clearTimeout } = manualTimers();
    const config = { ...baseConfig(), mode: 'dial' as const, url: 'http://host/', token: 'abc' };
    const bridge = createMainBridge(config, events, { WebSocket: FakeSocket as unknown as MainBridgeDeps['WebSocket'], fetch: vi.fn(), setTimeout, clearTimeout });
    bridge.start();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0].url).toBe('ws://host/assist-bridge?token=abc');
    FakeSocket.instances[0].open();
    expect(bridge.state().status).toBe('connected');
  });

  it('falls back to HTTP polling when the dial WebSocket fails before opening, then connects via a successful poll', async () => {
    const { events, messages } = fakeEvents();
    const { setTimeout, clearTimeout } = manualTimers();
    const helloMsg = { v: 1, id: 'm1', time: 1, type: 'hello', payload: { app: 'MainDroid' } };
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, events: [helloMsg], cursor: 'c1' }), { status: 200 }));
    const config = { ...baseConfig(), mode: 'dial' as const, url: 'http://host', token: 'abc' };
    const bridge = createMainBridge(config, events, { WebSocket: FakeSocket as unknown as MainBridgeDeps['WebSocket'], fetch: fetchSpy, setTimeout, clearTimeout });
    bridge.start();
    FakeSocket.instances[0].drop(1006, '');
    await flushMicrotasks();
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledWith('http://host/api/assist-bridge/events?after=', { headers: { Authorization: 'Bearer abc' } });
    expect(bridge.state().status).toBe('connected');
    expect(messages).toContainEqual(helloMsg);
  });

  it('dial: a connected session going away reports error and schedules a retry at the minimum backoff', () => {
    const { events } = fakeEvents();
    const { setTimeout, clearTimeout, timers } = manualTimers();
    const config = { ...baseConfig(), mode: 'dial' as const, url: 'http://host', backoffMinMs: 1000, backoffMaxMs: 8000 };
    const bridge = createMainBridge(config, events, { WebSocket: FakeSocket as unknown as MainBridgeDeps['WebSocket'], fetch: vi.fn(), setTimeout, clearTimeout });
    bridge.start();
    FakeSocket.instances[0].open();
    FakeSocket.instances[0].drop(1000, 'gone');
    expect(bridge.state().status).toBe('error');
    expect(timers.at(-1)?.ms).toBe(1000);
  });

  it('dial: repeated connection failures double the backoff delay, capped at the maximum', async () => {
    const { events } = fakeEvents();
    const { setTimeout, clearTimeout, timers } = manualTimers();
    const fetchSpy = vi.fn().mockRejectedValue(new Error('network down'));
    const config = { ...baseConfig(), mode: 'dial' as const, url: 'http://host', backoffMinMs: 100, backoffMaxMs: 350 };
    const bridge = createMainBridge(config, events, { fetch: fetchSpy, setTimeout, clearTimeout });
    bridge.start();
    await flushMicrotasks();
    expect(timers.at(-1)?.ms).toBe(100);
    timers.at(-1)!.fn();
    await flushMicrotasks();
    expect(timers.at(-1)?.ms).toBe(200);
    timers.at(-1)!.fn();
    await flushMicrotasks();
    expect(timers.at(-1)?.ms).toBe(350);
  });

  it('a listener failure reported twice schedules one retry, and stop() leaves the bridge off for good', async () => {
    let handlers: ListenHandlers | undefined;
    const listen = vi.fn((_o: ListenOptions, h: ListenHandlers): Promise<void> => {
      handlers = h;
      h.onError('port in use');
      return Promise.reject(new Error('port in use'));
    });
    const native = { listen, send: vi.fn(), stop: vi.fn() } as unknown as MainBridgeNativeApi;
    const { events } = fakeEvents();
    const { setTimeout, clearTimeout, timers } = manualTimers();
    const bridge = createMainBridge({ ...baseConfig(), mode: 'listen' }, events, { fetch: vi.fn(), native, setTimeout, clearTimeout });
    bridge.start();
    await flushMicrotasks();
    expect(handlers).toBeDefined();
    expect(timers.map((t) => t.ms)).toEqual([1000]);
    expect(bridge.state().status).toBe('error');
    bridge.stop();
    timers.forEach((t) => t.fn());
    expect(bridge.state().status).toBe('off');
    expect(listen).toHaveBeenCalledTimes(1);
  });

  it('stop(): sets status off and ignores any late transport callbacks', () => {
    const native = fakeNative();
    const { events } = fakeEvents();
    const { setTimeout, clearTimeout } = manualTimers();
    const bridge = createMainBridge({ ...baseConfig(), mode: 'listen' }, events, { fetch: vi.fn(), native: native as unknown as MainBridgeNativeApi, setTimeout, clearTimeout });
    bridge.start();
    bridge.stop();
    expect(bridge.state()).toEqual({ status: 'off', lastError: null, peer: null });
    native.handlers!.onOpen('late-peer');
    expect(bridge.state().status).toBe('off');
  });

  it('logs connect and disconnect events, and never logs the token', () => {
    const native = fakeNative();
    const { events, logs } = fakeEvents();
    const { setTimeout, clearTimeout } = manualTimers();
    const config = { ...baseConfig(), mode: 'listen' as const, token: 'super-secret' };
    const bridge = createMainBridge(config, events, { fetch: vi.fn(), native: native as unknown as MainBridgeNativeApi, setTimeout, clearTimeout });
    bridge.start();
    native.handlers!.onOpen('peer-a');
    native.handlers!.onClose('bye');
    expect(logs.some((l) => /connected/i.test(l.message))).toBe(true);
    expect(logs.some((l) => /disconnected/i.test(l.message))).toBe(true);
    expect(logs.every((l) => !l.message.includes('super-secret'))).toBe(true);
  });
});

// --- COMMANDS ------------------------------------------------------------------

describe('COMMANDS', () => {
  it('send() while not connected returns NOT_CONNECTED without throwing', async () => {
    const { events } = fakeEvents();
    const { setTimeout, clearTimeout } = manualTimers();
    const bridge = createMainBridge({ ...baseConfig(), mode: 'dial', url: '' }, events, { fetch: vi.fn(), setTimeout, clearTimeout });
    bridge.start();
    await expect(bridge.send('request_frame', {})).resolves.toEqual({ ok: false, message: NOT_CONNECTED });
  });

  it('send() while connected writes a JSON envelope of the given type and payload to the transport', async () => {
    const native = fakeNative();
    const { events } = fakeEvents();
    const { setTimeout, clearTimeout } = manualTimers();
    const bridge = createMainBridge({ ...baseConfig(), mode: 'listen' }, events, { fetch: vi.fn(), native: native as unknown as MainBridgeNativeApi, setTimeout, clearTimeout });
    bridge.start();
    native.handlers!.onOpen('peer');
    const result = await bridge.send('request_frame', {});
    expect(result.ok).toBe(true);
    expect(native.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(native.send.mock.calls[0][0] as string);
    expect(sent).toMatchObject({ v: 1, type: 'request_frame', payload: {} });
  });

  it('request() resolves with the result payload the main app replied with, matched by replyTo', async () => {
    const native = fakeNative();
    const { events } = fakeEvents();
    const { setTimeout, clearTimeout } = manualTimers();
    const bridge = createMainBridge({ ...baseConfig(), mode: 'listen' }, events, { fetch: vi.fn(), native: native as unknown as MainBridgeNativeApi, setTimeout, clearTimeout });
    bridge.start();
    native.handlers!.onOpen('peer');
    const promise = bridge.request('request_frame', {});
    await flushMicrotasks();
    const sentId = (JSON.parse(native.send.mock.calls[0][0] as string) as { id: string }).id;
    native.handlers!.onMessage(JSON.stringify({ v: 1, id: 'r1', time: 1, type: 'result', replyTo: sentId, payload: { ok: true, message: 'done' } }));
    await expect(promise).resolves.toEqual({ ok: true, message: 'done' });
  });

  it('request() times out with a plain failure when its timer fires before any reply', async () => {
    const native = fakeNative();
    const { events } = fakeEvents();
    const { setTimeout, clearTimeout, timers } = manualTimers();
    const bridge = createMainBridge({ ...baseConfig(), mode: 'listen' }, events, { fetch: vi.fn(), native: native as unknown as MainBridgeNativeApi, setTimeout, clearTimeout });
    bridge.start();
    native.handlers!.onOpen('peer');
    const promise = bridge.request('request_frame', {}, 5000);
    await flushMicrotasks();
    const timeoutTimer = timers.find((t) => t.ms === 5000)!;
    timeoutTimer.fn();
    const result = await promise;
    expect(result.ok).toBe(false);
  });

  it('an invalid inbound message is logged as a warning and never reaches onMessage', () => {
    const native = fakeNative();
    const { events, messages, logs } = fakeEvents();
    const { setTimeout, clearTimeout } = manualTimers();
    const bridge = createMainBridge({ ...baseConfig(), mode: 'listen' }, events, { fetch: vi.fn(), native: native as unknown as MainBridgeNativeApi, setTimeout, clearTimeout });
    bridge.start();
    native.handlers!.onOpen('peer');
    native.handlers!.onMessage('not json');
    expect(messages).toHaveLength(0);
    expect(logs.some((l) => l.tone === 'warn')).toBe(true);
  });
});
