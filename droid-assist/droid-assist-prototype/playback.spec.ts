import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_REQUIRED, HISTORY_UNSUPPORTED } from './bridge.js';
import type { HistoryRecord } from './bridge.js';
import { fetchPlayback, lastWindow, recordToStep } from './playback.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

const record = (overrides: Partial<HistoryRecord> = {}): HistoryRecord => ({ id: 'r1', timestamp: 0, inputKind: 'mouse', action: 'click', x: 960, y: 540, ...overrides });

describe('lastWindow', () => {
  it('keeps only records with inputKind within 30000 ms before now, oldest first', () => {
    const now = 100_000;
    const inWindow1 = record({ id: 'a', timestamp: now - 20_000 });
    const inWindow2 = record({ id: 'b', timestamp: now - 5_000 });
    const tooOld = record({ id: 'c', timestamp: now - 31_000 });
    const noInput = { id: 'd', timestamp: now - 1_000 } as HistoryRecord;
    expect(lastWindow([inWindow2, tooOld, inWindow1, noInput], now)).toEqual([inWindow1, inWindow2]);
  });
});

describe('recordToStep', () => {
  const screen = { w: 1920, h: 1080 };

  it('maps a mouse click at 960,540 on 1920x1080 to {action:"click",x:0.5,y:0.5}', () => {
    const r = record({ inputKind: 'mouse', action: 'click', x: 960, y: 540 });
    expect(recordToStep(r, screen)).toMatchObject({ action: 'click', x: 0.5, y: 0.5 });
  });

  it('maps a keyboard "type" input "hello" to action "type" text "hello"', () => {
    const r = record({ inputKind: 'keyboard', action: 'type', input: 'hello', x: undefined, y: undefined });
    expect(recordToStep(r, screen)).toMatchObject({ action: 'type', text: 'hello' });
  });

  it('maps a keyboard input "ctrl+c" with no action to "key"', () => {
    const r = record({ inputKind: 'keyboard', action: undefined, input: 'ctrl+c', x: undefined, y: undefined });
    expect(recordToStep(r, screen)).toMatchObject({ action: 'key', text: 'ctrl+c' });
  });
});

describe('fetchPlayback', () => {
  const screen = { w: 1920, h: 1080 };

  it('returns entries with step and shot when history and screenshot both succeed', async () => {
    const r = record({ id: 'r1', timestamp: 1000, screenshotId: 'shot1' });
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(json(200, { success: true, history: [r] }))
      .mockResolvedValueOnce(json(200, { success: true, imageData: 'data:image/png;base64,AA' }));
    vi.stubGlobal('fetch', fetchSpy);
    const now = 1000;
    const result = await fetchPlayback('http://pc', 'tok', screen, now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.playback.entries).toHaveLength(1);
      expect(result.playback.entries[0].shot).toBe('data:image/png;base64,AA');
      expect(result.playback.entries[0].step).toMatchObject({ action: 'click' });
    }
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/api/ai/action-history?limit=200&windowSec=30');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('honours a 10-minute window: requests the last 600 s and keeps a 9-minute-old action, drops an 11-minute-old one', async () => {
    const now = 1_000_000;
    const recent = record({ id: 'nine', timestamp: now - 9 * 60_000 });
    const stale = record({ id: 'eleven', timestamp: now - 11 * 60_000 });
    const fetchSpy = vi.fn().mockResolvedValueOnce(json(200, { success: true, history: [stale, recent] }));
    vi.stubGlobal('fetch', fetchSpy);
    const result = await fetchPlayback('http://pc', 'tok', screen, now, 600);
    expect(fetchSpy.mock.calls[0][0]).toContain('windowSec=600');
    expect(fetchSpy.mock.calls[0][0]).toContain('limit=2400');
    expect(result.ok && result.playback.entries.map((e) => e.record.id)).toEqual(['nine']);
    expect(result.ok && result.playback.windowSec).toBe(600);
  });

  it('a 30 s window drops a 2-minute-old action', async () => {
    const now = 1_000_000;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(200, { success: true, history: [record({ id: 'old', timestamp: now - 120_000 })] })));
    const result = await fetchPlayback('http://pc', 'tok', screen, now, 30);
    expect(result.ok && result.playback.entries).toEqual([]);
  });

  it('fails with HISTORY_UNSUPPORTED on 404, without fetching a screenshot', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(json(404, {}));
    vi.stubGlobal('fetch', fetchSpy);
    const result = await fetchPlayback('http://pc', 'tok', screen);
    expect(result).toEqual({ ok: false, message: HISTORY_UNSUPPORTED });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('fails with HISTORY_UNSUPPORTED on a 200 reply without a history array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(200, { success: true })));
    const result = await fetchPlayback('http://pc', 'tok', screen);
    expect(result).toEqual({ ok: false, message: HISTORY_UNSUPPORTED });
  });

  it('fails with BRIDGE_REQUIRED when bridgeUrl is empty', async () => {
    const result = await fetchPlayback('', 'tok', screen);
    expect(result).toEqual({ ok: false, message: BRIDGE_REQUIRED });
  });
});
