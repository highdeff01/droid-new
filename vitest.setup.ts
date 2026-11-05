import { beforeEach, vi } from 'vitest';

/**
 * Vitest setup: remote hosts are offline by default, so no spec reaches a real AI endpoint or
 * bridge that happens to be reachable from the machine running the suite. Loopback stays real for
 * specs that start their own local server. A spec that needs a model or a bridge stubs `fetch`
 * itself (vi.stubGlobal), and vi.unstubAllGlobals restores this default.
 */
const realFetch = globalThis.fetch;
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/;

/** fetch that reaches a local test server only; any other host fails as an unreachable endpoint. */
const localOnlyFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (LOCAL.test(url)) return realFetch(input, init);
  throw new TypeError('Failed to fetch');
};

globalThis.fetch = localOnlyFetch;

/** Unless a spec stubs `fetch` itself, each spec starts from the local-only fetch. */
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(localOnlyFetch));
});
