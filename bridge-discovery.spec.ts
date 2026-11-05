import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_REQUIRED, BRIDGE_UNAUTHORIZED, type BridgeResult } from './bridge.js';
import { applyCandidate, BRIDGE_PORTS, candidateUrls, discoverBridges, localSubnets, probeCandidate, verifyBridge } from './bridge-discovery.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok: BridgeResult = { ok: true, message: 'Desktop bridge online' };
const offline: BridgeResult = { ok: false, message: `${BRIDGE_REQUIRED} (offline: refused)` };

afterEach(() => vi.unstubAllGlobals());

describe('localSubnets and candidateUrls', () => {
  it('derives /24 subnets from private IPv4 hints and ignores public or named hosts', () => {
    expect(localSubnets(['10.4.7.22', 'http://172.20.1.9:3000', 'example.com', '8.8.8.8', '10.4.7.80'])).toEqual(['10.4.7', '172.20.1']);
  });

  it('falls back to the common home subnets when no hint is on a private network', () => {
    expect(localSubnets(['localhost', '', '/bridge'])).toEqual(['192.168.1', '192.168.0']);
  });

  it('probes localhost first, then every host of the subnet, on the bridge port', () => {
    const urls = candidateUrls(['10.0.5.3']);
    expect(BRIDGE_PORTS).toContain(3000);
    expect(urls.slice(0, 2)).toEqual(['http://127.0.0.1:3000', 'http://localhost:3000']);
    expect(urls).toContain('http://10.0.5.1:3000');
    expect(urls).toContain('http://10.0.5.254:3000');
    expect(urls).not.toContain('http://10.0.5.0:3000');
    expect(urls).toHaveLength(2 + 254);
  });

  it('covers every given port without duplicates', () => {
    const urls = candidateUrls(['10.0.5.3', '10.0.5.9'], [3000, 3001]);
    expect(urls).toContain('http://localhost:3001');
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toHaveLength((2 + 254) * 2);
  });
});

describe('probeCandidate', () => {
  it('lists an answering bridge with its latency, using the real health call and token', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(json(200, { success: true, status: 'ok' }));
    vi.stubGlobal('fetch', fetchSpy);
    const clock = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(142.4);
    expect(await probeCandidate('http://127.0.0.1:3000', 'tok', undefined, clock)).toEqual({ url: 'http://127.0.0.1:3000', latencyMs: 42, status: 'online', insecure: false });
    expect(fetchSpy.mock.calls[0][0]).toBe('http://127.0.0.1:3000/api/health');
    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('lists a bridge that refuses the token as needing one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { success: false })));
    expect((await probeCandidate('http://127.0.0.1:3000', ''))?.status).toBe('needs-token');
  });

  it('drops hosts that are unreachable or answer with another error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await probeCandidate('http://10.0.0.9:3000', 'tok')).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(500, {})));
    expect(await probeCandidate('http://10.0.0.9:3000', 'tok')).toBeNull();
  });

  it('marks a plain-http LAN candidate insecure but not a loopback one', async () => {
    const check = vi.fn().mockResolvedValue(ok);
    expect((await probeCandidate('http://192.168.1.40:3000', 'tok', check))?.insecure).toBe(true);
    expect((await probeCandidate('http://localhost:3000', 'tok', check))?.insecure).toBe(false);
  });
});

describe('discoverBridges', () => {
  it('returns only responsive candidates, fastest first, and reports progress', async () => {
    const delays: Record<string, number> = { 'http://a:3000': 30, 'http://c:3000': 5 };
    const check = vi.fn(async (url: string) => {
      if (url === 'http://b:3000') return offline;
      await new Promise((r) => setTimeout(r, delays[url]));
      return url === 'http://c:3000' ? { ok: false, message: BRIDGE_UNAUTHORIZED } : ok;
    });
    const progress: number[] = [];
    const found = await discoverBridges(['http://a:3000', 'http://b:3000', 'http://c:3000'], 'tok', { check, concurrency: 3, onProgress: (n) => progress.push(n) });
    expect(found.map((c) => [c.url, c.status])).toEqual([['http://c:3000', 'needs-token'], ['http://a:3000', 'online']]);
    expect(found[0].latencyMs).toBeLessThanOrEqual(found[1].latencyMs);
    expect(progress).toEqual([1, 2, 3]);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('returns an empty list when nothing answers', async () => {
    expect(await discoverBridges(['http://a:3000', 'http://b:3000'], 'tok', { check: vi.fn().mockResolvedValue(offline) })).toEqual([]);
  });
});

describe('applyCandidate', () => {
  it('auto-fills the bridge URL and leaves every other setting as it was', () => {
    const settings = { bridgeUrl: '/bridge', bridgeToken: 'keep', aiUrl: 'http://ai' };
    const next = applyCandidate(settings, { url: 'http://10.0.0.7:3000', latencyMs: 3, status: 'online', insecure: true });
    expect(next).toEqual({ bridgeUrl: 'http://10.0.0.7:3000', bridgeToken: 'keep', aiUrl: 'http://ai' });
    expect(settings.bridgeUrl).toBe('/bridge');
  });
});

describe('verifyBridge', () => {
  it('passes only after the health check and a completed dry wait run', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, message: 'Performed wait' });
    const steps = await verifyBridge('http://127.0.0.1:3000', 'tok', { check: vi.fn().mockResolvedValue(ok), send });
    expect(steps.map((s) => [s.step, s.ok])).toEqual([['health', true], ['dry-run', true]]);
    const [url, step, , , opts] = send.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3000');
    expect(step.action).toBe('wait');
    expect(opts.token).toBe('tok');
  });

  it('stops at a failed health check without sending anything', async () => {
    const send = vi.fn();
    const steps = await verifyBridge('http://127.0.0.1:3000', 'bad', { check: vi.fn().mockResolvedValue({ ok: false, message: BRIDGE_UNAUTHORIZED }), send });
    expect(steps).toEqual([{ step: 'health', ok: false, message: BRIDGE_UNAUTHORIZED }]);
    expect(send).not.toHaveBeenCalled();
  });

  it('reports the dry run failure the bridge gave', async () => {
    const send = vi.fn().mockResolvedValue({ ok: false, message: 'PC failed: no display' });
    const steps = await verifyBridge('http://127.0.0.1:3000', 'tok', { check: vi.fn().mockResolvedValue(ok), send });
    expect(steps[1]).toEqual({ step: 'dry-run', ok: false, message: 'PC failed: no display' });
  });

  it('sends the dry run as a real wait replay through the bridge', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(json(200, { success: true }))
      .mockResolvedValueOnce(json(202, { success: true, run: { id: 'r1', status: 'running' } }))
      .mockResolvedValueOnce(json(200, { success: true, run: { id: 'r1', status: 'completed' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const steps = await verifyBridge('http://127.0.0.1:3000', 'tok');
    expect(steps.every((s) => s.ok)).toBe(true);
    const body = JSON.parse(fetchSpy.mock.calls[1][1].body);
    expect(body.steps.map((s: { action: string }) => s.action)).toEqual(['wait']);
  });
});
