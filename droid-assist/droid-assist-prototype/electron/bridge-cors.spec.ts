// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BRIDGE_URL_PATTERNS, withBridgeCors } from './bridge-cors.js';

describe('withBridgeCors', () => {
  it('replaces the bridge allowlist headers with permissive ones and keeps the rest', () => {
    const out = withBridgeCors({ 'access-control-allow-origin': ['http://x'], 'content-type': ['application/json'] });
    expect(out['access-control-allow-origin']).toBeUndefined();
    expect(out['Access-Control-Allow-Origin']).toEqual(['*']);
    expect(out['Access-Control-Allow-Methods'][0]).toContain('POST');
    expect(out['Access-Control-Allow-Headers'][0]).toContain('Content-Type');
    expect(out['Access-Control-Allow-Headers'][0]).toContain('Authorization');
    expect(out['content-type']).toEqual(['application/json']);
  });

  it('works when the response has no headers', () => {
    expect(withBridgeCors(undefined)['Access-Control-Allow-Origin']).toEqual(['*']);
  });

  it('targets the replay and health endpoints', () => {
    expect(BRIDGE_URL_PATTERNS.some((p) => p.endsWith('/api/replay'))).toBe(true);
    expect(BRIDGE_URL_PATTERNS.some((p) => p.endsWith('/api/health'))).toBe(true);
  });
});
