import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAIN_APP_POLL_MS, claimRequests, publishStatus, reportResult, serveMainApp, type AssistStatus, type MainAppRequest } from './main-app-bridge.js';
import type { InvocationRecord, Registry } from './capabilities.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const status: AssistStatus = { time: 1, armed: true, aborted: false, running: true, goal: 'test goal', steps: 3, settings: {}, capabilities: ['snip'] };

const record = (patch: Partial<InvocationRecord> = {}): InvocationRecord => ({ time: 1, requester: 'main-app', id: 'snip', params: {}, ok: true, result: 'snipped', ...patch });

afterEach(() => vi.unstubAllGlobals());

describe('serveMainApp', () => {
  it('publishes status with a bearer header, invokes a claimed request as main-app and reports its result', async () => {
    const pending: MainAppRequest = { requestId: 'r1', id: 'snip', params: { x: 0.5 }, status: 'pending' };
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(json(200, { success: true }))
      .mockResolvedValueOnce(json(200, { success: true, requests: [pending] }))
      .mockResolvedValueOnce(json(200, { success: true, request: { ...pending, status: 'done' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const invoke = vi.fn().mockResolvedValue(record({ id: 'snip', params: { x: 0.5 } }));
    const registry: Pick<Registry, 'invoke'> = { invoke };

    const records = await serveMainApp('http://pc:3000', 'tok', status, registry);

    expect(records).toEqual([record({ id: 'snip', params: { x: 0.5 } })]);
    const [statusUrl, statusInit] = fetchSpy.mock.calls[0];
    expect(statusUrl).toBe('http://pc:3000/api/assist/status');
    expect(statusInit.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(statusInit.body)).toEqual(status);
    expect(invoke).toHaveBeenCalledWith('snip', { x: 0.5 }, { kind: 'main-app' });
    const [resultUrl, resultInit] = fetchSpy.mock.calls[2];
    expect(resultUrl).toBe('http://pc:3000/api/assist/requests/r1/result');
    expect(JSON.parse(resultInit.body)).toEqual({ ok: true, result: 'snipped' });
  });

  it('reports a refused invocation (ok:false) as a failed result', async () => {
    const pending: MainAppRequest = { requestId: 'r2', id: 'guard.arm', params: {}, status: 'pending' };
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(json(200, { success: true }))
      .mockResolvedValueOnce(json(200, { success: true, requests: [pending] }))
      .mockResolvedValueOnce(json(200, { success: true, request: { ...pending, status: 'failed' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const refused = record({ id: 'guard.arm', ok: false, result: '"guard.arm" is a guardrail — only the user may invoke it' });
    const registry: Pick<Registry, 'invoke'> = { invoke: vi.fn().mockResolvedValue(refused) };

    const records = await serveMainApp('http://pc:3000', 'tok', status, registry);

    expect(records).toEqual([refused]);
    expect(JSON.parse(fetchSpy.mock.calls[2][1].body)).toEqual({ ok: false, result: refused.result });
  });

  it('makes no fetch call and returns [] when no bridge is configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const registry: Pick<Registry, 'invoke'> = { invoke: vi.fn() };
    expect(await serveMainApp('', 'tok', status, registry)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(registry.invoke).not.toHaveBeenCalled();
  });

  it('returns [] without throwing when the bridge is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const registry: Pick<Registry, 'invoke'> = { invoke: vi.fn() };
    expect(await serveMainApp('http://pc:3000', 'tok', status, registry)).toEqual([]);
  });
});

describe('publishStatus', () => {
  it('returns false without throwing on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await publishStatus('http://pc', 'tok', status)).toBe(false);
  });
});

describe('claimRequests', () => {
  it('drops entries missing a string requestId or id', async () => {
    const requests = [{ requestId: 'ok1', id: 'snip', params: {}, status: 'running' }, { requestId: 'ok2' }, { id: 'no-request-id' }, { requestId: 42, id: 'bad-type' }, null];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { success: true, requests })));
    const claimed = await claimRequests('http://pc', 'tok');
    expect(claimed).toEqual([{ requestId: 'ok1', id: 'snip', params: {}, status: 'running' }]);
  });

  it('defaults params to {} when the claimed entry has none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { success: true, requests: [{ requestId: 'r1', id: 'snip' }] })));
    expect(await claimRequests('http://pc', 'tok')).toEqual([{ requestId: 'r1', id: 'snip', params: {}, status: 'running' }]);
  });

  it('returns [] without throwing on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await claimRequests('http://pc', 'tok')).toEqual([]);
  });
});

describe('reportResult', () => {
  it('returns false without throwing on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await reportResult('http://pc', 'tok', 'r1', record())).toBe(false);
  });
});

describe('MAIN_APP_POLL_MS', () => {
  it('is a positive poll interval in milliseconds', () => {
    expect(MAIN_APP_POLL_MS).toBeGreaterThan(0);
  });
});
