import { describe, expect, it, vi } from 'vitest';
import { routeV2, type PeerHandlers, type V2Machinery, type V2Router } from './bridge-v2-handlers.js';
import { envelope, validateInbound, type InboundMessage, type PeerType } from './main-bridge-protocol.js';

// --- Shared fakes -----------------------------------------------------------

/** Builds one validated v2 inbound message from a type and payload, failing the test if it is invalid. */
function inboundMessage(type: string, payload: object): InboundMessage {
  const result = validateInbound({ v: 2, id: 'm1', time: 1, type, payload });
  if (!result.ok) throw new Error(`expected a valid ${type} payload, got: ${result.error}`);
  return result.message;
}

/** A fake V2Machinery whose methods resolve a distinct result each, so a test can tell them apart. */
function fakeMachinery(): V2Machinery {
  return {
    analyze: vi.fn(async () => ({ ok: true, message: 'analyzed' })),
    plan: vi.fn(async () => ({ ok: true, message: 'planned' })),
    run: vi.fn(async () => ({ ok: true, message: 'ran' })),
    verify: vi.fn(async () => ({ ok: true, message: 'verified' })),
    watch: vi.fn(async () => ({ ok: true, message: 'watching' })),
    assistError: vi.fn(async () => ({ ok: true, message: 'noted' })),
  };
}

/** A fake PeerHandlers recording each call. */
function fakePeers(): PeerHandlers {
  return {
    user_request: vi.fn(),
    takeover: vi.fn(),
    regulate: vi.fn(),
    step_opinion: vi.fn(),
    console_log: vi.fn(),
    app_state: vi.fn(),
  };
}

/** Waits a tick so a routeV2 request's `.then(reply)` has run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const PEER_GOOD_PAYLOADS: Record<PeerType, object> = {
  user_request: { text: 'do a thing', from: 'droid-main' },
  takeover: { reason: 'timeout', goal: 'open settings', index: 0, step: 'click', steps: ['click'], log: ['started'] },
  regulate: { command: 'pause' },
  step_opinion: { index: 0, step: 'click', agree: true },
  console_log: { app: 'droid-main', level: 'error', message: 'oops' },
  app_state: { app: 'droid-main', running: true, goal: 'open settings', steps: 3, activeIndex: 1, agentsBusy: 2 },
};

// --- validateInbound ---------------------------------------------------------

describe('validateInbound', () => {
  it('accepts a v1 envelope', () => {
    expect(validateInbound({ v: 1, id: 'm0', time: 1, type: 'hello', payload: { app: 'main' } }).ok).toBe(true);
  });

  it('accepts a v2 envelope', () => {
    expect(validateInbound({ v: 2, id: 'm1', time: 1, type: 'analyze', payload: {} }).ok).toBe(true);
  });

  it('rejects a v3 envelope', () => {
    const result = validateInbound({ v: 3, id: 'm1', time: 1, type: 'analyze', payload: {} });
    expect(result.ok).toBe(false);
  });

  const GOOD_PAYLOADS: Record<string, object> = {
    analyze: { question: 'what is this' },
    plan_workflow: { goal: 'open settings' },
    run_workflow: { goal: 'open settings', selfTest: true },
    verify: { goal: 'open settings' },
    watch: { on: true, target: 'button' },
    assist_error: { message: 'boom', goal: 'open settings' },
    ...PEER_GOOD_PAYLOADS,
  };

  it.each(Object.keys(GOOD_PAYLOADS))('accepts a good %s payload', (type) => {
    expect(validateInbound({ v: 2, id: 'm1', time: 1, type, payload: GOOD_PAYLOADS[type] }).ok).toBe(true);
  });

  const BAD_PAYLOADS: Record<string, object> = {
    analyze: { question: 42 },
    plan_workflow: {},
    run_workflow: { selfTest: 'yes' },
    verify: { goal: 5 },
    watch: {},
    assist_error: {},
    user_request: { text: 'hi' },
    takeover: { reason: 'r', goal: 'g', index: 0, step: 's' },
    regulate: { command: 'explode' },
    step_opinion: { index: 0, step: 'click' },
    console_log: { app: 'droid-main', level: 'bogus', message: 'oops' },
    app_state: { app: 'droid-main', running: true, goal: 'g' },
  };

  it.each(Object.keys(BAD_PAYLOADS))('rejects a bad %s payload', (type) => {
    expect(validateInbound({ v: 2, id: 'm1', time: 1, type, payload: BAD_PAYLOADS[type] }).ok).toBe(false);
  });

  it('rejects a regulate mode command without a mode', () => {
    const result = validateInbound({ v: 2, id: 'm1', time: 1, type: 'regulate', payload: { command: 'mode' } });
    expect(result.ok).toBe(false);
  });
});

// --- envelope ----------------------------------------------------------------

describe('envelope', () => {
  it('sends a v1 outbound type as v1', () => {
    expect(envelope('request_frame', {}).v).toBe(1);
  });

  it('sends a result as v2 with the given replyTo', () => {
    const e = envelope('result', { ok: true, message: 'x' }, 'r1');
    expect(e.v).toBe(2);
    expect(e.replyTo).toBe('r1');
  });

  it('sends a takeover message as v2', () => {
    const e = envelope('takeover', { reason: 'r', goal: 'g', index: 0, step: 's', steps: ['s'], log: [] });
    expect(e.v).toBe(2);
  });
});

// --- routeV2 -------------------------------------------------------------

describe('routeV2', () => {
  it('calls analyze with the trimmed (empty) question and replies with its result', async () => {
    const machinery = fakeMachinery();
    const reply = vi.fn();
    const message = inboundMessage('analyze', {});
    expect(routeV2(message, { machinery, peers: fakePeers(), reply } as V2Router)).toBe(true);
    await flush();
    expect(machinery.analyze).toHaveBeenCalledWith('');
    expect(reply).toHaveBeenCalledWith({ ok: true, message: 'analyzed' }, message.id);
  });

  it('calls run with the trimmed goal and selfTest true for a run_workflow request', async () => {
    const machinery = fakeMachinery();
    const reply = vi.fn();
    const message = inboundMessage('run_workflow', { goal: '  open  ', selfTest: true });
    routeV2(message, { machinery, peers: fakePeers(), reply } as V2Router);
    await flush();
    expect(machinery.run).toHaveBeenCalledWith('open', true);
  });

  it('calls run with undefined and false for an empty run_workflow request', async () => {
    const machinery = fakeMachinery();
    const reply = vi.fn();
    const message = inboundMessage('run_workflow', {});
    routeV2(message, { machinery, peers: fakePeers(), reply } as V2Router);
    await flush();
    expect(machinery.run).toHaveBeenCalledWith(undefined, false);
  });

  it('calls plan with the trimmed goal for a plan_workflow request', async () => {
    const machinery = fakeMachinery();
    const reply = vi.fn();
    const message = inboundMessage('plan_workflow', { goal: '  open settings  ' });
    routeV2(message, { machinery, peers: fakePeers(), reply } as V2Router);
    await flush();
    expect(machinery.plan).toHaveBeenCalledWith('open settings');
  });

  it('calls verify with undefined for an empty verify request', async () => {
    const machinery = fakeMachinery();
    const reply = vi.fn();
    const message = inboundMessage('verify', {});
    routeV2(message, { machinery, peers: fakePeers(), reply } as V2Router);
    await flush();
    expect(machinery.verify).toHaveBeenCalledWith(undefined);
  });

  it('calls watch with on and the trimmed target for a watch request', async () => {
    const machinery = fakeMachinery();
    const reply = vi.fn();
    const message = inboundMessage('watch', { on: true, target: '  button  ' });
    routeV2(message, { machinery, peers: fakePeers(), reply } as V2Router);
    await flush();
    expect(machinery.watch).toHaveBeenCalledWith(true, 'button');
  });

  it('calls assistError with the trimmed message and goal for an assist_error request', async () => {
    const machinery = fakeMachinery();
    const reply = vi.fn();
    const message = inboundMessage('assist_error', { message: '  boom  ', goal: '  open  ' });
    routeV2(message, { machinery, peers: fakePeers(), reply } as V2Router);
    await flush();
    expect(machinery.assistError).toHaveBeenCalledWith('boom', 'open');
  });

  it('replies with a failed result naming the type when the machinery throws', async () => {
    const machinery = fakeMachinery();
    machinery.analyze = vi.fn(() => {
      throw new Error('boom');
    });
    const reply = vi.fn();
    const message = inboundMessage('analyze', {});
    routeV2(message, { machinery, peers: fakePeers(), reply } as V2Router);
    await flush();
    expect(reply).toHaveBeenCalledWith({ ok: false, message: 'analyze failed: boom' }, message.id);
  });

  it.each(Object.keys(PEER_GOOD_PAYLOADS) as PeerType[])('dispatches a %s message only to its own peer handler and returns true', (type) => {
    const peers = fakePeers();
    const message = inboundMessage(type, PEER_GOOD_PAYLOADS[type]);
    const result = routeV2(message, { machinery: fakeMachinery(), peers, reply: vi.fn() } as V2Router);
    expect(result).toBe(true);
    expect(peers[type]).toHaveBeenCalledWith(message.payload);
    for (const [otherType, handler] of Object.entries(peers)) {
      if (otherType !== type) expect(handler).not.toHaveBeenCalled();
    }
  });

  it('returns false and calls nothing for a hello message', () => {
    const peers = fakePeers();
    const reply = vi.fn();
    const message = inboundMessage('hello', { app: 'droid-main' });
    const result = routeV2(message, { machinery: fakeMachinery(), peers, reply } as V2Router);
    expect(result).toBe(false);
    expect(reply).not.toHaveBeenCalled();
    for (const handler of Object.values(peers)) expect(handler).not.toHaveBeenCalled();
  });

  it('returns false and calls nothing for a frame message', () => {
    const peers = fakePeers();
    const reply = vi.fn();
    const message = inboundMessage('frame', { image: 'data:image/jpeg;base64,AAAA', width: 10, height: 10 });
    const result = routeV2(message, { machinery: fakeMachinery(), peers, reply } as V2Router);
    expect(result).toBe(false);
    expect(reply).not.toHaveBeenCalled();
    for (const handler of Object.values(peers)) expect(handler).not.toHaveBeenCalled();
  });
});
