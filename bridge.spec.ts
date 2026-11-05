import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_REQUIRED, BRIDGE_UNAUTHORIZED, captureDesktop, checkBridge, humanMoveMs, insecureBridgeUrl, nativeActions, selfTestBridge, sendToBridge } from './bridge.js';
import type { WorkflowStep } from './types.js';

describe('nativeActions for an auto-navigate type step', () => {
  const step = (mappedId?: string): WorkflowStep => ({ id: 's', name: 'n', action: 'type', x: 0.5, y: 0.25, text: 'hi', status: 'pending', ...(mappedId ? { mappedId } : {}) });
  it('clicks the mapped element at its position before typing into it', () => {
    expect(nativeActions(step('m1'), 800, 400).map((a) => [a.action, a.x, a.y, a.text])).toEqual([['click', 400, 100, undefined], ['type_text', 400, 100, 'hi']]);
  });
  it('types without a click for an ordinary type step', () => {
    expect(nativeActions(step(), 800, 400).map((a) => a.action)).toEqual(['type_text']);
  });
});

const step = (patch: Partial<WorkflowStep>): WorkflowStep => ({ id: 's1', name: 'Step', action: 'click', x: 0.5, y: 0.25, status: 'pending', ...patch });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('nativeActions', () => {
  it('clicks at the corrected position in native pixels', () => {
    expect(nativeActions(step({ correctedX: 0.25, correctedY: 0.5 }), 1920, 1080)).toEqual([{ action: 'click', x: 480, y: 540, delayMs: 200 }]);
  });

  it('presses a key step `repeat` times (one backspace per character to erase)', () => {
    const presses = nativeActions(step({ action: 'key', text: 'backspace', repeat: 3 }), 100, 100);
    expect(presses.map((a) => [a.action, a.keyPayload])).toEqual([['press_key', 'backspace'], ['press_key', 'backspace'], ['press_key', 'backspace']]);
  });

  it('maps every action to real keyboard or mouse input', () => {
    const kinds = (s: WorkflowStep) => nativeActions(s, 100, 100).map((a) => a.keyPayload ?? a.text ?? a.action);
    expect(kinds(step({ action: 'type', text: 'hello' }))).toEqual(['hello']);
    expect(kinds(step({ action: 'key', text: 'ctrl+s' }))).toEqual(['ctrl+s']);
    expect(nativeActions(step({ action: 'key', text: 'ctrl+s' }), 100, 100)[0].action).toBe('hotkey');
    expect(kinds(step({ action: 'open_app', text: 'notepad' }))).toEqual(['win', 'wait', 'notepad', 'enter']);
    expect(kinds(step({ action: 'search', text: 'cats' }))).toEqual(['ctrl+l', 'cats', 'enter']);
    expect(kinds(step({ action: 'calc', text: '2+3' }))).toContain('2+3');
    expect(kinds(step({ action: 'media' }))).toEqual(['playpause']);
    expect(kinds(step({ action: 'wait' }))).toEqual(['wait']);
  });

  it('moves the cursor without clicking, over a humanized duration', () => {
    const [move, ...rest] = nativeActions(step({ action: 'move', correctedX: 0.1, correctedY: 0.9 }), 1000, 500);
    expect(rest).toEqual([]);
    expect(move).toMatchObject({ action: 'move', x: 100, y: 450 });
    expect(move.durationMs).toBeGreaterThanOrEqual(250);
    expect(move.durationMs).toBeLessThanOrEqual(550);
    expect(humanMoveMs(() => 0)).toBe(250);
    expect(humanMoveMs(() => 1)).toBe(550);
  });

  it('carries a recorded step\'s measured human pause instead of the fixed default', () => {
    expect(nativeActions(step({ delayMs: 730 }), 100, 100)).toEqual([expect.objectContaining({ action: 'click', delayMs: 730 })]);
    expect(nativeActions(step({ action: 'key', text: 'ctrl+shift+t', delayMs: 0 }), 100, 100)).toEqual([expect.objectContaining({ action: 'hotkey', keyPayload: 'ctrl+shift+t', delayMs: 0 })]);
    const [first, wait] = nativeActions(step({ action: 'open_app', text: 'notepad', delayMs: 1500 }), 100, 100);
    expect(first.delayMs).toBe(1500);
    expect(wait).toMatchObject({ action: 'wait', delayMs: 600 });
    expect(nativeActions(step({ action: 'measure', delayMs: 50 }), 100, 100)).toEqual([]);
  });

  it('maps double_click and scroll to real pointer input at the target', () => {
    expect(nativeActions(step({ action: 'double_click' }), 1000, 500)).toEqual([expect.objectContaining({ action: 'double_click', x: 500, y: 125 })]);
    expect(nativeActions(step({ action: 'scroll', text: 'up' }), 1000, 500)[0]).toMatchObject({ action: 'scroll', x: 500, y: 125, keyPayload: 'up' });
    expect(nativeActions(step({ action: 'scroll' }), 1000, 500)[0]).toMatchObject({ action: 'scroll', keyPayload: 'down' });
  });
});

describe('sendToBridge', () => {
  it('fails with the connect-the-bridge error when no bridge is configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await sendToBridge('', step({}), 1920, 1080);
    expect(r).toEqual({ ok: false, message: BRIDGE_REQUIRED });
    expect(r.message).toMatch(/connect the bridge/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails loudly when the bridge is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const r = await sendToBridge('http://127.0.0.1:9', step({}), 1920, 1080);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/connect the bridge/);
  });

  it('succeeds only after the PC reports the run completed', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(json(202, { success: true, run: { id: 'r1', status: 'running' } }))
      .mockResolvedValueOnce(json(200, { success: true, run: { id: 'r1', status: 'running' } }))
      .mockResolvedValueOnce(json(200, { success: true, run: { id: 'r1', status: 'completed' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const r = await sendToBridge('http://pc:3000/', step({ correctedX: 0.1, correctedY: 0.2 }), 1000, 500, { pollMs: 1 });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('(100, 100)px');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://pc:3000/api/replay');
    expect(JSON.parse(init.body).steps[0]).toMatchObject({ action: 'click', x: 100, y: 100 });
    expect(fetchSpy.mock.calls[2][0]).toBe('http://pc:3000/api/replay/r1');
  });

  it('sends each recorded step\'s measured delay in the bridge payload', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(json(202, { success: true, run: { id: 'r3', status: 'running' } }))
      .mockResolvedValueOnce(json(200, { success: true, run: { id: 'r3', status: 'completed' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const r = await sendToBridge('http://pc', step({ action: 'scroll', text: 'up', delayMs: 1240 }), 100, 100, { pollMs: 1 });
    expect(r.ok).toBe(true);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).steps).toEqual([expect.objectContaining({ action: 'scroll', keyPayload: 'up', delayMs: 1240 })]);
  });

  it('reports the PC failure when the run failed', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json(202, { success: true, run: { id: 'r2', status: 'running' } }))
      .mockResolvedValueOnce(json(200, { success: true, run: { id: 'r2', status: 'failed', error: 'pyautogui missing' } })));
    const r = await sendToBridge('http://pc', step({}), 100, 100, { pollMs: 1 });
    expect(r).toEqual({ ok: false, message: 'PC failed: pyautogui missing' });
  });

  it('reports a rejected start', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(409, { success: false, error: 'Device already has an active replay' })));
    const r = await sendToBridge('http://pc', step({}), 100, 100);
    expect(r).toEqual({ ok: false, message: 'Device already has an active replay' });
  });
});

describe('checkBridge and captureDesktop', () => {
  it('require a configured bridge', async () => {
    expect((await checkBridge('', 't')).message).toBe(BRIDGE_REQUIRED);
    expect(await captureDesktop('', 't')).toEqual({ ok: false, message: BRIDGE_REQUIRED });
  });

  it('report an offline bridge with the connect-the-bridge error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const r = await checkBridge('http://127.0.0.1:9', 't');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/connect the bridge/);
  });

  it('returns the desktop screenshot the bridge captured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { success: true, frame: { image: 'data:image/png;base64,AA==', width: 1920, height: 1080 } })));
    expect(await captureDesktop('http://pc', 't')).toEqual({ ok: true, frame: { image: 'data:image/png;base64,AA==', width: 1920, height: 1080 } });
  });
});

describe('bridge auth token', () => {
  const TOKEN = 'tok-9f2';

  it('sends the token as a bearer header on the replay start and every poll', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(json(202, { success: true, run: { id: 'r9', status: 'running' } }))
      .mockResolvedValueOnce(json(200, { success: true, run: { id: 'r9', status: 'completed' } }));
    vi.stubGlobal('fetch', fetchSpy);
    expect((await sendToBridge('http://pc', step({}), 100, 100, { token: TOKEN, pollMs: 1 })).ok).toBe(true);
    for (const [, init] of fetchSpy.mock.calls) expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(fetchSpy.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
  });

  it('sends the token on capture and health checks', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(json(200, { success: true, frame: { image: 'x', width: 1, height: 1 } }));
    vi.stubGlobal('fetch', fetchSpy);
    await captureDesktop('http://pc', TOKEN);
    await checkBridge('http://pc', TOKEN);
    expect(fetchSpy.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
  });

  it('sends no Authorization header when no token is set', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(json(200, {}));
    vi.stubGlobal('fetch', fetchSpy);
    await checkBridge('http://pc', '');
    expect(fetchSpy.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });

  it('reports a 401 or 403 as unauthorized — check bridge token, on every call, without the token value', async () => {
    for (const status of [401, 403]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(status, { success: false, error: 'nope' })));
      const results = [
        await sendToBridge('http://pc', step({}), 100, 100, { token: TOKEN }),
        await captureDesktop('http://pc', TOKEN),
        await checkBridge('http://pc', TOKEN),
      ];
      for (const r of results) {
        expect(r).toEqual({ ok: false, message: BRIDGE_UNAUTHORIZED });
        expect(r.ok === false && r.message).not.toContain(TOKEN);
      }
    }
    expect(BRIDGE_UNAUTHORIZED).toMatch(/unauthorized — check bridge token/);
  });

  it('reports an auth refusal while polling a run', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json(202, { success: true, run: { id: 'r3', status: 'running' } }))
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 })));
    const r = await sendToBridge('http://pc', step({}), 100, 100, { token: 'stale', pollMs: 1 });
    expect(r).toEqual({ ok: false, message: `PC failed: ${BRIDGE_UNAUTHORIZED}` });
  });
});

describe('insecureBridgeUrl', () => {
  it('flags plain http to a LAN or remote host', () => {
    for (const url of ['http://192.168.1.50:3000', 'http://desktop-pc:3000/', 'HTTP://10.0.0.2', ' http://bridge.example.com ']) expect(insecureBridgeUrl(url)).toBe(true);
  });

  it('accepts localhost, loopback, https and same-origin proxy URLs', () => {
    for (const url of ['', '/bridge', 'http://localhost:3000', 'http://127.0.0.1:3000', 'http://127.4.5.6', 'http://[::1]:3000', 'http://pc.localhost', 'https://192.168.1.50:3000']) expect(insecureBridgeUrl(url)).toBe(false);
  });
});

describe('selfTestBridge', () => {
  it('sends one real move to the screen centre through /api/replay and reports the run id the PC confirmed', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(json(200, { success: true, run: { id: 'run-42', status: 'running' } }))
      .mockResolvedValueOnce(json(200, { success: true, run: { id: 'run-42', status: 'completed' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const out = await selfTestBridge('http://pc:8080', 'tok', 2560, 1440);
    expect(out.ok).toBe(true);
    expect(out.message).toMatch(/Real input verified.*run run-42/);
    expect(fetchSpy.mock.calls[0][0]).toBe('http://pc:8080/api/replay');
    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).steps).toEqual([expect.objectContaining({ action: 'move', x: 1280, y: 720 })]);
  });

  it('reports the bridge error when the PC fails the run', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json(200, { success: true, run: { id: 'r', status: 'running' } }))
      .mockResolvedValueOnce(json(200, { success: true, run: { id: 'r', status: 'failed', error: 'pyautogui FailSafeException' } })));
    const out = await selfTestBridge('http://pc', '', 1920, 1080);
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/NOT verified — PC failed: pyautogui FailSafeException/);
  });

  it('fails loudly when the bridge is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const out = await selfTestBridge('http://pc', '', 1920, 1080);
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/NOT verified.*unreachable: Failed to fetch/);
  });
});
