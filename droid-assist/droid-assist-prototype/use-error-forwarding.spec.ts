import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssistSettings, Frame, LogEntry } from './types.js';
import { useErrorForwarding } from './use-error-forwarding.js';
import { DEFAULT_SETTINGS } from './use-assist.js';
import { OUTBOX_LIMIT, buildReport } from './error-forwarding.js';
import { loadOutbox, saveOutbox } from './storage.js';

const frame = { url: 'data:image/jpeg;base64,QUJD' } as Frame;
const on: AssistSettings = { ...DEFAULT_SETTINGS, errorForwarding: true, errorUrl: 'http://fix/api', errorToken: 'SECRET123' };

function setup(settings: AssistSettings) {
  const log: LogEntry[] = [];
  const addLog = vi.fn((source: string, message: string, tone: LogEntry['tone'] = 'info') => {
    log.unshift({ id: String(log.length), time: Date.now(), source, message, tone });
  });
  const hook = renderHook(() => useErrorForwarding(settings, addLog, () => ({ log, frame })));
  return { ...hook, log, addLog };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

describe('useErrorForwarding', () => {
  it('forwards a captured error with its screenshot and logs the outcome', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const { result, log } = setup(on);
    act(() => result.current.capture({ kind: 'ai', message: 'AI unavailable — HTTP 503', goal: 'open notepad' }));
    await waitFor(() => expect(result.current.errors[0].status).toBe('sent'));
    const body = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ kind: 'ai', goal: 'open notepad', screenshot: 'data:image/jpeg;base64,QUJD' });
    expect(result.current.endpoint.state).toBe('ok');
    expect(log[0]).toMatchObject({ source: 'Errors', tone: 'ok' });
  });

  it('suppresses a duplicate inside the window but Send now still sends it', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = setup(on);
    act(() => result.current.capture({ kind: 'step', message: 'not found', step: 'Click' }));
    act(() => result.current.capture({ kind: 'step', message: 'not found', step: 'Click' }));
    await waitFor(() => expect(result.current.errors[0].status).toBe('sent'));
    expect(result.current.errors).toHaveLength(1);
    expect(result.current.errors[0].repeats).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await act(() => result.current.sendNow(result.current.errors[0].report));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('lands a failed send in the persisted outbox after one retry, without logging the token', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError('connect ECONNREFUSED SECRET123'));
    vi.stubGlobal('fetch', fetchSpy);
    const { result, log } = setup(on);
    act(() => result.current.capture({ kind: 'bridge', message: 'Bridge offline' }));
    await waitFor(() => expect(result.current.errors[0].status).toBe('outbox'), { timeout: 3000 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.current.endpoint.state).toBe('failed');
    expect(loadOutbox().map((r) => r.message)).toEqual(['Bridge offline']);
    expect(JSON.stringify(log)).not.toContain('SECRET123');
  });

  it('keeps errors listed but unsent while forwarding is off', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = setup({ ...on, errorForwarding: false });
    act(() => result.current.capture({ kind: 'drift', message: 'Drift red' }));
    expect(result.current.errors[0].status).toBe('not sent');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Send test posts a sample payload and reports failure in the log', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    const { result, log } = setup({ ...on, errorForwarding: false });
    await act(() => result.current.sendTest());
    expect(log[0]).toMatchObject({ source: 'Errors', tone: 'error' });
    expect(log[0].message).toMatch(/Test error not delivered — HTTP 401/);
  });

  it('restores the outbox on start with a Resend status', () => {
    const reports = Array.from({ length: OUTBOX_LIMIT + 5 }, (_, i) => buildReport({ kind: 'ai', message: `m${i}` }, [], null, ''));
    saveOutbox(reports);
    expect(loadOutbox()).toHaveLength(OUTBOX_LIMIT);
    const { result } = setup(on);
    expect(result.current.errors).toHaveLength(OUTBOX_LIMIT);
    expect(result.current.errors.every((e) => e.status === 'outbox')).toBe(true);
    localStorage.setItem('droid-assist.outbox', '{');
    expect(loadOutbox()).toEqual([]);
  });
});
