/**
 * Vitest setup: remote hosts are offline by default, so no spec reaches a real AI endpoint or
 * bridge that happens to be reachable from the machine running the suite. Loopback stays real for
 * specs that start their own local server. A spec that needs a model or a bridge stubs `fetch`
 * itself (vi.stubGlobal), and vi.unstubAllGlobals restores this default.
 */
const realFetch = globalThis.fetch;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

const hostOf = (input: Parameters<typeof fetch>[0]): string | null => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

globalThis.fetch = async (input, init) => {
  const host = hostOf(input);
  if (host && LOOPBACK.has(host)) return realFetch(input, init);
  throw new TypeError('Failed to fetch (remote hosts are offline in tests)');
};
