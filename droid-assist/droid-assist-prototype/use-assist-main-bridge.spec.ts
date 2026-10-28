import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAssist } from './use-assist.js';
import { loadSettings } from './storage.js';
import { LISTEN_NEEDS_DESKTOP } from './main-bridge.js';
import type { ListenHandlers, ListenOptions, MainBridgeNativeApi } from './electron/main-bridge-api.js';

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

/** jsdom has no image decoding or canvas: a decodable Image and a 2D context that draws nothing. */
class FakeImage {
  src = '';
  naturalWidth = 640;
  naturalHeight = 360;
  decode(): Promise<void> {
    return this.src.startsWith('data:image/') ? Promise.resolve() : Promise.reject(new Error('cannot decode'));
  }
}

const fakeContext = {
  drawImage: () => {},
  getImageData: (_x: number, _y: number, w: number, h: number) => new ImageData(new Uint8ClampedArray(w * h * 4), w, h),
};

type Sent = { id: string; type: string; payload: Record<string, unknown> };

/** A fake Electron listener on window.droidMainBridge: captures the handlers and every message sent. */
function installMainBridge(reply: (env: Sent) => Record<string, unknown> | null = () => null) {
  const state: { handlers?: ListenHandlers; options?: ListenOptions; sent: Sent[] } = { sent: [] };
  const api: MainBridgeNativeApi = {
    listen: vi.fn(async (options: ListenOptions, handlers: ListenHandlers) => {
      state.options = options;
      state.handlers = handlers;
    }),
    send: vi.fn(async (text: string) => {
      const env = JSON.parse(text) as Sent;
      state.sent.push(env);
      const payload = reply(env);
      if (payload) setTimeout(() => state.handlers?.onMessage(JSON.stringify({ v: 1, id: `r-${env.id}`, time: Date.now(), type: 'result', replyTo: env.id, payload })), 5);
      return true;
    }),
    stop: vi.fn(),
  };
  window.droidMainBridge = api;
  return state;
}

const inbound = (type: string, payload: unknown) => JSON.stringify({ v: 1, id: `m-${Math.random()}`, time: Date.now(), type, payload });
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));
const sentOf = (sent: Sent[], type: string) => sent.filter((s) => s.type === type);

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,BB');
});

afterEach(() => {
  cleanup();
  delete window.droidMainBridge;
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function connected(reply?: (env: Sent) => Record<string, unknown> | null) {
  const bridge = installMainBridge(reply);
  const hook = renderHook(() => useAssist());
  await act(async () => {});
  act(() => bridge.handlers!.onOpen('ws 10.0.0.5'));
  await settle();
  return { bridge, result: hook.result };
}

describe('main app bridge — connection lifecycle', () => {
  it('starts with the app, listening on the persisted host and port with the token, and waits for the main app', async () => {
    localStorage.setItem('droid-assist.settings', JSON.stringify({ mainBridgeHost: '0.0.0.0', mainBridgePort: 9100, mainBridgeToken: 's3cret' }));
    const bridge = installMainBridge();
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    expect(bridge.options).toEqual({ host: '0.0.0.0', port: 9100, token: 's3cret' });
    expect(result.current.mainBridge.status).toBe('waiting');
    expect(result.current.log.every((l) => !l.message.includes('s3cret'))).toBe(true);
  });

  it('goes Connected when the main app connects and back to waiting when it leaves, logging both with timestamps', async () => {
    const { bridge, result } = await connected();
    expect(result.current.mainBridge).toMatchObject({ status: 'connected', peer: 'ws 10.0.0.5' });
    act(() => bridge.handlers!.onClose('socket closed'));
    expect(result.current.mainBridge.status).toBe('waiting');
    const entries = result.current.log.filter((l) => l.source === 'Main app');
    expect(entries.some((l) => /connected/i.test(l.message))).toBe(true);
    expect(entries.some((l) => /disconnected/i.test(l.message))).toBe(true);
    expect(entries.every((l) => typeof l.time === 'number' && l.time > 0)).toBe(true);
  });

  it('a listener failure shows Error with the last error in plain words', async () => {
    const bridge = installMainBridge();
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => bridge.handlers!.onError('port 8787 is already in use'));
    expect(result.current.mainBridge.status).toBe('error');
    expect(result.current.mainBridge.lastError).toMatch(/port 8787 is already in use/);
  });

  it('listen mode in a plain browser (no desktop listener) reports the plain error instead of waiting', async () => {
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    expect(result.current.mainBridge).toMatchObject({ status: 'error', lastError: LISTEN_NEEDS_DESKTOP });
  });

  it('disabled: no listener is started and the status is off', async () => {
    localStorage.setItem('droid-assist.settings', JSON.stringify({ mainBridgeEnabled: false }));
    const bridge = installMainBridge();
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    expect(bridge.handlers).toBeUndefined();
    expect(result.current.mainBridge.status).toBe('off');
  });

  it('restarts the bridge when its settings change', async () => {
    const bridge = installMainBridge();
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => result.current.setSettings({ ...result.current.settings, mainBridgePort: 9200 }));
    await act(async () => {});
    expect(bridge.options?.port).toBe(9200);
    expect(JSON.parse(localStorage.getItem('droid-assist.settings')!).mainBridgePort).toBe(9200);
  });
});

describe('main app bridge — settings persistence and validation', () => {
  it('restores valid stored bridge settings', () => {
    localStorage.setItem('droid-assist.settings', JSON.stringify({ mainBridgeEnabled: false, mainBridgeMode: 'dial', mainBridgeUrl: 'http://main:5000', mainBridgeToken: 't', mainBridgePort: 4000, mainBridgeBackoffMinMs: 500, mainBridgeBackoffMaxMs: 60000 }));
    expect(loadSettings(DEFAULT_SETTINGS)).toMatchObject({ mainBridgeEnabled: false, mainBridgeMode: 'dial', mainBridgeUrl: 'http://main:5000', mainBridgeToken: 't', mainBridgePort: 4000, mainBridgeBackoffMinMs: 500, mainBridgeBackoffMaxMs: 60000 });
  });

  it('keeps the defaults for out-of-range or invalid stored values', () => {
    localStorage.setItem('droid-assist.settings', JSON.stringify({ mainBridgeMode: 'broadcast', mainBridgePort: 70000, mainBridgeBackoffMinMs: 100, mainBridgeBackoffMaxMs: 500000, mainBridgeHost: '  ' }));
    expect(loadSettings(DEFAULT_SETTINGS)).toMatchObject({ mainBridgeMode: 'listen', mainBridgePort: 8787, mainBridgeBackoffMinMs: 1000, mainBridgeBackoffMaxMs: 30000, mainBridgeHost: '127.0.0.1' });
  });

  it('a stored maximum below the minimum falls back to the default maximum', () => {
    localStorage.setItem('droid-assist.settings', JSON.stringify({ mainBridgeBackoffMinMs: 8000, mainBridgeBackoffMaxMs: 2000 }));
    expect(loadSettings(DEFAULT_SETTINGS)).toMatchObject({ mainBridgeBackoffMinMs: 8000, mainBridgeBackoffMaxMs: 30000 });
  });
});

describe('main app bridge — frames as a capture source', () => {
  it('on connect the main app preview becomes the screen source and a fresh frame is requested', async () => {
    const { bridge, result } = await connected();
    expect(result.current.source).toBe('main-app');
    expect(sentOf(bridge.sent, 'request_frame')).not.toHaveLength(0);
  });

  it('an inbound JPEG frame enters the gallery as a main-app frame with its native size', async () => {
    const { bridge, result } = await connected();
    act(() => bridge.handlers!.onMessage(inbound('frame', { image: 'data:image/jpeg;base64,AA', width: 1280, height: 720 })));
    await settle();
    expect(result.current.frames[0]).toMatchObject({ source: 'main-app', srcW: 1280, srcH: 720 });
    expect(result.current.shotCount).toBeGreaterThan(0);
  });

  it('a non-JPEG frame is rejected and logged, never shown', async () => {
    const { bridge, result } = await connected();
    act(() => bridge.handlers!.onMessage(inbound('frame', { image: 'data:image/png;base64,AA', width: 10, height: 10 })));
    await settle();
    expect(result.current.frames).toHaveLength(0);
    expect(result.current.log.some((l) => l.source === 'Main app' && l.tone === 'warn')).toBe(true);
  });

  it('does not take over when the user explicitly chose the demo desktop, but stays selectable', async () => {
    const bridge = installMainBridge();
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => result.current.useDemo());
    act(() => bridge.handlers!.onOpen('ws peer'));
    await settle();
    expect(result.current.source).toBe('demo');
    act(() => {
      result.current.selectMainApp();
    });
    expect(result.current.source).toBe('main-app');
  });
});

describe('main app bridge — commands and intercept routing', () => {
  const el = { id: 'el1', name: 'Save button', x: 0.3, y: 0.6, source: 'familiar' as const };

  it('dry-runs a replay on the connected main-app frame without the desktop bridge', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      throw new TypeError('offline');
    }));
    const { bridge, result } = await connected();
    act(() => bridge.handlers!.onMessage(inbound('frame', { image: 'data:image/jpeg;base64,AA', width: 1280, height: 720 })));
    await settle();
    act(() => result.current.loadCard({ id: 'dry', name: 'Dry run', description: '', savedAt: 0, steps: [{ id: 'dry', name: 'Click Save', action: 'click', target: 'Save button', x: 0.3, y: 0.6, status: 'pending' }] }));

    await act(() => result.current.replay());

    expect(result.current.steps[0].status).toBe('pending');
    expect(result.current.log.some((l) => l.message.includes('verified on the main-app frame'))).toBe(true);
    expect(calls.some((url) => url.includes('/api/health') || url.includes('/api/replay'))).toBe(false);
    expect(sentOf(bridge.sent, 'run_script')).toHaveLength(0);
  });

  it('armed: a click on the main-app source is sent as run_script and the main app result is the outcome', async () => {
    const { bridge, result } = await connected((env) => (env.type === 'run_script' ? { ok: true, message: 'clicked Save' } : null));
    act(() => result.current.toggleArmed());
    await act(() => result.current.testClick(el));
    const scripts = sentOf(bridge.sent, 'run_script');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].payload).toMatchObject({ action: 'click', x: 0.3, y: 0.6 });
    expect(result.current.log.find((l) => l.source === 'Test click')?.message).toMatch(/Main app: clicked Save/);
  });

  it('a failed run_script fails the step loudly and is forwarded as a main-app error', async () => {
    const { result } = await connected((env) => (env.type === 'run_script' ? { ok: false, message: 'preview not focused' } : null));
    act(() => result.current.toggleArmed());
    await act(() => result.current.testClick(el));
    expect(result.current.log.find((l) => l.source === 'Test click')?.message).toMatch(/preview not focused/);
    expect(result.current.errors.find((e) => e.report.kind === 'main-app')?.report.message).toMatch(/preview not focused/);
  });

  it('reports state to the main app when arming changes', async () => {
    const { bridge, result } = await connected();
    act(() => result.current.toggleArmed());
    await settle();
    expect(sentOf(bridge.sent, 'report_state').at(-1)?.payload).toMatchObject({ source: 'main-app', armed: true });
  });

  it('element_moved goes on the agent bus from the main app, is predefined for planning and a fresh frame is requested', async () => {
    const { bridge, result } = await connected();
    const before = sentOf(bridge.sent, 'request_frame').length;
    act(() => bridge.handlers!.onMessage(inbound('intercept', { kind: 'element_moved', message: 'Save moved', element: { name: 'Save', x: 0.7, y: 0.2 } })));
    await settle();
    expect(result.current.bus.some((m) => m.from === 'mainApp' && m.element.name === 'Save')).toBe(true);
    expect(result.current.knownElements).toContainEqual({ name: 'Save', x: 0.7, y: 0.2 });
    expect(sentOf(bridge.sent, 'request_frame').length).toBe(before + 1);
    expect(result.current.log.some((l) => l.source === 'Main app' && /element_moved/.test(l.message))).toBe(true);
  });

  it('error_occurred goes on the agent bus and into error forwarding as a main-app error', async () => {
    const { bridge, result } = await connected();
    act(() => bridge.handlers!.onMessage(inbound('intercept', { kind: 'error_occurred', message: 'Checkout crashed' })));
    await settle();
    expect(result.current.errors.find((e) => e.report.kind === 'main-app')?.report.message).toBe('Checkout crashed');
    expect(result.current.bus.some((m) => m.from === 'mainApp' && m.to === 'supervisor')).toBe(true);
  });

  it('test_requested runs the link/route tester with the requested spec', async () => {
    const { bridge, result } = await connected();
    act(() => result.current.triggerAbort('test'));
    act(() => bridge.handlers!.onMessage(inbound('intercept', { kind: 'test_requested', message: 'check routes', test: 'test routes /home /cart' })));
    await settle();
    expect(result.current.log.some((l) => l.source === 'Supervisor' && /Link\/route test refused/.test(l.message))).toBe(true);
    expect(result.current.bus.some((m) => m.from === 'mainApp')).toBe(true);
  });

  it('an element forwarded to the main app on the bus is sent as an intercept notice', async () => {
    const { bridge, result } = await connected();
    act(() => result.current.forwardElement('coords', { name: 'Cart icon', x: 0.9, y: 0.1 }, ['mainApp']));
    await settle();
    expect(sentOf(bridge.sent, 'intercept_notice').at(-1)?.payload).toEqual({ from: 'Coordinate learner', element: { name: 'Cart icon', x: 0.9, y: 0.1 } });
  });

  it('forwarding to the main app while disconnected notes the plain failure and sends nothing', async () => {
    const bridge = installMainBridge();
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => result.current.forwardElement('coords', { name: 'Cart icon', x: 0.9, y: 0.1 }, ['mainApp']));
    expect(sentOf(bridge.sent, 'intercept_notice')).toHaveLength(0);
    expect(result.current.bus.find((m) => m.to === 'mainApp')?.note).toMatch(/not connected/);
  });
});
