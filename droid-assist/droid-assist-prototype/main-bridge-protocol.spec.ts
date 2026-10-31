import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, envelope, validateInbound } from './main-bridge-protocol.js';

describe('validateInbound', () => {
  const env = (type: string, payload: unknown) => ({ v: PROTOCOL_VERSION, id: 'x', type, payload });

  it('accepts a status payload with load 0.4 and a capabilities list', () => {
    expect(validateInbound(env('status', { load: 0.4, capabilities: ['a'] }))).toMatchObject({ ok: true });
  });

  it('rejects a status payload with load out of range', () => {
    expect(validateInbound(env('status', { load: 2, capabilities: ['a'] }))).toMatchObject({ ok: false });
  });

  it('rejects a status payload with capabilities missing', () => {
    expect(validateInbound(env('status', { load: 0.4 }))).toMatchObject({ ok: false });
  });

  it('accepts a console_error intercept with a message, carrying the file', () => {
    const result = validateInbound(env('intercept', { kind: 'console_error', message: 'TypeError: x', file: 'src/app.ts' }));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect((result.message.payload as { file?: string }).file).toBe('src/app.ts');
  });

  it('rejects a console_error intercept with a blank message', () => {
    expect(validateInbound(env('intercept', { kind: 'console_error', message: '   ' }))).toMatchObject({ ok: false });
  });

  it('existing kinds are still valid, requiring element_moved to carry an element', () => {
    const ok = validateInbound(env('intercept', { kind: 'element_moved', message: 'moved', element: { name: 'Btn', x: 0.1, y: 0.2 } }));
    expect(ok).toMatchObject({ ok: true });
    const missing = validateInbound(env('intercept', { kind: 'element_moved', message: 'moved' }));
    expect(missing).toMatchObject({ ok: false });
  });
});

describe('envelope', () => {
  it('builds a joint_request envelope with PROTOCOL_VERSION and the given payload', () => {
    const payload = { operation: 'Save file', role: 'perform' as const, goal: 'Checkout', reason: 'cheapest' };
    const env = envelope('joint_request', payload);
    expect(env.v).toBe(PROTOCOL_VERSION);
    expect(env.type).toBe('joint_request');
    expect(env.payload).toEqual(payload);
  });

  it('builds a code_fix envelope with PROTOCOL_VERSION and the given payload', () => {
    const payload = { file: 'a.ts', problem: 'bug', fix: 'patch', approvalId: 'apv-1' };
    const env = envelope('code_fix', payload);
    expect(env.v).toBe(PROTOCOL_VERSION);
    expect(env.type).toBe('code_fix');
    expect(env.payload).toEqual(payload);
  });
});
