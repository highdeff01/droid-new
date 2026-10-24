import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBridgeFrame } from './bridge.js';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('fetchBridgeFrame', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the captured data URL from GET <bridge>/api/screen-capture', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, imageData: 'data:image/png;base64,QUJD' }));
    vi.stubGlobal('fetch', fetchMock);

    const r = await fetchBridgeFrame('/bridge/');

    expect(fetchMock.mock.calls[0][0]).toBe('/bridge/api/screen-capture');
    expect(r.ok).toBe(true);
    expect(r.imageData).toBe('data:image/png;base64,QUJD');
  });

  it('reports a 503 capture failure without an image', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(503, { success: false, error: 'Screen capture unavailable' })));

    const r = await fetchBridgeFrame('http://127.0.0.1:3000');

    expect(r.ok).toBe(false);
    expect(r.imageData).toBeUndefined();
    expect(r.message).toBe('Screen capture unavailable');
  });

  it('reports success:false even on HTTP 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { success: false })));

    const r = await fetchBridgeFrame('http://127.0.0.1:3000');

    expect(r.ok).toBe(false);
    expect(r.message).toBe('Screen capture HTTP 200');
  });

  it('never throws when the bridge is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const r = await fetchBridgeFrame('http://127.0.0.1:3000');

    expect(r.ok).toBe(false);
    expect(r.message).toContain('fetch failed');
  });
});
