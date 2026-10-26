/** Headers the desktop bridge's responses need for the Electron renderer to read them. */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/** URL patterns of the bridge endpoints sendToBridge / checkBridge call. */
export const BRIDGE_URL_PATTERNS = ['*://*/api/replay', '*://*/api/replay/*', '*://*/api/health'];

/**
 * Returns the response headers with any CORS headers replaced by permissive ones. The
 * bridge's CORS allowlist is empty by default and the packaged renderer runs on file://,
 * so without this the bridge's replies would be unreadable from inside Electron.
 */
export function withBridgeCors(headers: Record<string, string[]> = {}): Record<string, string[]> {
  const kept = Object.entries(headers).filter(([name]) => !name.toLowerCase().startsWith('access-control-allow-'));
  return { ...Object.fromEntries(kept), ...Object.fromEntries(Object.entries(CORS_HEADERS).map(([k, v]) => [k, [v]])) };
}
