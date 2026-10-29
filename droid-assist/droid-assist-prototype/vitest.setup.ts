import { beforeEach, vi } from 'vitest';

const realFetch = globalThis.fetch;
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/;

/**
 * Specs never reach a remote host: unless a spec stubs `fetch` itself, a request to anything but a
 * local test server fails as an unreachable endpoint, so results never depend on a live AI endpoint.
 */
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (LOCAL.test(url)) return realFetch(input, init);
    throw new TypeError('Failed to fetch');
  }));
});
