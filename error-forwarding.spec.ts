import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Frame, LogEntry } from './types.js';
import { DUPLICATE_WINDOW_MS, LOG_CONTEXT, buildReport, deliver, isErrorReport, logErrorKind, postReport, redact, suppressDuplicate } from './error-forwarding.js';

describe('logErrorKind', () => {
  it('maps an error log line source to its error kind, a step failure by default', () => {
    expect(logErrorKind('Desktop bridge')).toBe('bridge');
    expect(logErrorKind('Drift monitor')).toBe('drift');
    expect(logErrorKind('Screen watcher')).toBe('watcher');
    expect(logErrorKind('AI')).toBe('ai');
    expect(logErrorKind('Supervisor')).toBe('ai');
    expect(logErrorKind('Main retry')).toBe('step');
  });
});

const entry = (n: number, message = `line ${n}`): LogEntry => ({ id: `l${n}`, time: n, source: 'Planner', message, tone: 'error' });
const frame = { url: 'data:image/jpeg;base64,QUJD' } as Frame;
const report = () => buildReport({ kind: 'ai', message: 'AI unavailable — HTTP 503', goal: 'open notepad', step: 'Click Start' }, [entry(1)], frame, '');

afterEach(() => vi.unstubAllGlobals());

describe('buildReport', () => {
  it('carries kind, message, goal, step, bounded log context and the JPEG screenshot', () => {
    const log = Array.from({ length: 20 }, (_, i) => entry(i));
    const r = buildReport({ kind: 'step', message: 'Target not found', goal: ' play video ', step: 'Click Play' }, log, frame, '', Date.UTC(2026, 0, 2));
    expect(r).toMatchObject({ kind: 'step', message: 'Target not found', goal: 'play video', step: 'Click Play', timestamp: '2026-01-02T00:00:00.000Z', screenshot: 'data:image/jpeg;base64,QUJD' });
    expect(r.recentLog).toHaveLength(LOG_CONTEXT);
    expect(r.recentLog[0]).toBe('[Planner] line 0');
    expect(isErrorReport(JSON.parse(JSON.stringify(r)))).toBe(true);
  });

  it('uses null for a missing goal, step and frame', () => {
    const r = buildReport({ kind: 'bridge', message: 'Bridge offline' }, [], null, '');
    expect(r).toMatchObject({ goal: null, step: null, screenshot: null, recentLog: [] });
  });

  it('masks the token in the message and the log context', () => {
    const r = buildReport({ kind: 'ai', message: 'bad SECRET123' }, [entry(1, 'token SECRET123')], null, 'SECRET123');
    expect(JSON.stringify(r)).not.toContain('SECRET123');
    expect(redact('a SECRET123 b', '')).toBe('a SECRET123 b');
  });
});

describe('suppressDuplicate', () => {
  it('suppresses the same key inside the window and lets it through after', () => {
    const seen = new Map<string, number>();
    expect(suppressDuplicate(seen, 'k', 0)).toBe(false);
    expect(suppressDuplicate(seen, 'k', DUPLICATE_WINDOW_MS - 1)).toBe(true);
    expect(suppressDuplicate(seen, 'other', 10)).toBe(false);
    expect(suppressDuplicate(seen, 'k', DUPLICATE_WINDOW_MS + 1)).toBe(false);
  });
});

describe('postReport / deliver', () => {
  it('POSTs JSON with a Bearer header only when a token is set', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await postReport('http://fix/api', 't0k', report())).toEqual({ ok: true, detail: 'HTTP 202' });
    expect(await postReport('http://fix/api', '', report())).toMatchObject({ ok: true });
    const [[url, withToken], [, without]] = fetchSpy.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(url).toBe('http://fix/api');
    expect(withToken.method).toBe('POST');
    expect((withToken.headers as Record<string, string>).Authorization).toBe('Bearer t0k');
    expect((without.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(withToken.body as string)).toMatchObject({ kind: 'ai', step: 'Click Start' });
  });

  it('retries once on a non-2xx answer, then reports the failure', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await deliver('http://fix', '', report(), 1, 0)).toEqual({ ok: false, detail: 'HTTP 500', attempts: 2 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('succeeds on the retry after a network error and never leaks the token', async () => {
    const fetchSpy = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed for SECRET123')).mockResolvedValueOnce(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await deliver('http://fix', 'SECRET123', report(), 1, 0)).toEqual({ ok: true, detail: 'HTTP 200', attempts: 2 });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('boom SECRET123')));
    expect((await postReport('http://fix', 'SECRET123', report())).detail).toBe('boom ***');
  });
});
