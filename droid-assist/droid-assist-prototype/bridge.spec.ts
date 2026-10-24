import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowStep } from './types.js';
import { captureBridgeScreen, launchOnBridge, sendToBridge } from './bridge.js';

const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const step = (over: Partial<WorkflowStep> = {}): WorkflowStep => ({ id: 's', name: 'Step', action: 'double_click', x: 0.5, y: 0.25, status: 'pending', ...over });

afterEach(() => vi.restoreAllMocks());

describe('bridge', () => {
  it('sends double-clicks as native pixels to /api/replay', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => reply({ success: true, run: { id: 'r1' } }));
    const r = await sendToBridge('http://pc:3000/', step(), 1920, 1080);
    expect(r.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://pc:3000/api/replay');
    expect(JSON.parse(String((init as RequestInit).body)).steps[0]).toMatchObject({ action: 'double_click', x: 960, y: 270 });
  });

  it('reports a bridge failure instead of success', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => reply({ success: false, error: 'pyautogui missing' }, 503));
    expect(await sendToBridge('http://pc', step({ action: 'click' }), 100, 100)).toEqual({ ok: false, message: 'pyautogui missing' });
  });

  it('returns the real screenshot from the capture endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => reply({ success: true, imageData: 'data:image/png;base64,AAAA' }));
    expect(await captureBridgeScreen('http://pc')).toMatchObject({ ok: true, image: 'data:image/png;base64,AAAA' });
  });

  it('fails a capture with no image', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => reply({ success: false, error: 'no display' }, 503));
    expect(await captureBridgeScreen('http://pc')).toMatchObject({ ok: false, message: 'no display' });
  });

  it('launches an app through the bridge', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => reply({ success: true }));
    expect((await launchOnBridge('http://pc', 'notepad')).ok).toBe(true);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({ launchApp: 'notepad' });
  });
});
