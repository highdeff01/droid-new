import { describe, expect, it, vi } from 'vitest';
import {
  askCapability,
  catalogText,
  createRegistry,
  invokeCapability,
  parseDoRequest,
  type Capability,
  type Caller,
} from './capability-registry.js';
import { stageOff } from './loop-control.js';
import type { AskFn } from './ai.js';

const cap = (overrides: Partial<Capability> = {}): Capability => ({
  id: 'script.run',
  description: 'Runs a saved script',
  params: [{ name: 'name', type: 'string', required: true, description: 'script name' }],
  access: 'all',
  invoke: vi.fn(async () => ({ ok: true, message: 'ran it' })),
  ...overrides,
});

describe('createRegistry', () => {
  it('throws on duplicate id', () => {
    expect(() => createRegistry([cap(), cap()])).toThrow('registered twice');
  });
});

describe('invokeCapability', () => {
  const stageOn = (_id: Parameters<typeof stageOff>[0]) => true;
  const stageOffFn = () => false;

  it('unknown id fails', async () => {
    const reg = createRegistry([cap()]);
    const r = await invokeCapability(reg, { kind: 'main' }, 'nope', {}, stageOn);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Unknown capability');
  });

  it("agent refused for access 'main'", async () => {
    const reg = createRegistry([cap({ access: 'main' })]);
    const caller: Caller = { kind: 'agent', stage: 'popup' };
    const r = await invokeCapability(reg, caller, 'script.run', { name: 'x' }, stageOn);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('may be invoked only by the main AI or the user');
  });

  it('agent refused when its stage is off (stageOff text)', async () => {
    const reg = createRegistry([cap()]);
    const caller: Caller = { kind: 'agent', stage: 'popup' };
    const r = await invokeCapability(reg, caller, 'script.run', { name: 'x' }, stageOffFn);
    expect(r.ok).toBe(false);
    expect(r.message).toContain(stageOff('popup'));
  });

  it('agent allowed when its stage is on', async () => {
    const invoke = vi.fn(async () => ({ ok: true, message: 'ran it' }));
    const reg = createRegistry([cap({ invoke })]);
    const caller: Caller = { kind: 'agent', stage: 'popup' };
    const r = await invokeCapability(reg, caller, 'script.run', { name: 'x' }, stageOn);
    expect(r.ok).toBe(true);
    expect(invoke).toHaveBeenCalled();
  });

  it("main/user allowed for 'main' caps", async () => {
    const invoke = vi.fn(async () => ({ ok: true, message: 'ran it' }));
    const reg = createRegistry([cap({ access: 'main', invoke })]);
    const rMain = await invokeCapability(reg, { kind: 'main' }, 'script.run', { name: 'x' }, stageOn);
    const rUser = await invokeCapability(reg, { kind: 'user' }, 'script.run', { name: 'x' }, stageOn);
    expect(rMain.ok).toBe(true);
    expect(rUser.ok).toBe(true);
  });

  it('missing required param refused without calling invoke', async () => {
    const invoke = vi.fn(async () => ({ ok: true, message: 'ran it' }));
    const reg = createRegistry([cap({ invoke })]);
    const r = await invokeCapability(reg, { kind: 'main' }, 'script.run', {}, stageOn);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('missing required parameter');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('wrong type param refused without calling invoke', async () => {
    const invoke = vi.fn(async () => ({ ok: true, message: 'ran it' }));
    const reg = createRegistry([cap({ invoke })]);
    const r = await invokeCapability(reg, { kind: 'main' }, 'script.run', { name: 42 }, stageOn);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('must be string');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('unknown param refused without calling invoke', async () => {
    const invoke = vi.fn(async () => ({ ok: true, message: 'ran it' }));
    const reg = createRegistry([cap({ invoke })]);
    const r = await invokeCapability(reg, { kind: 'main' }, 'script.run', { name: 'x', extra: 1 }, stageOn);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('unknown parameter');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('throwing invoke becomes ok:false', async () => {
    const invoke = vi.fn(async () => { throw new Error('boom'); });
    const reg = createRegistry([cap({ invoke })]);
    const r = await invokeCapability(reg, { kind: 'main' }, 'script.run', { name: 'x' }, stageOn);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('boom');
  });
});

describe('catalogText', () => {
  it("lists ids, '(main only)' and params", () => {
    const reg = createRegistry([cap({ id: 'presentation.build', access: 'main', description: 'Builds a presentation' })]);
    const text = catalogText(reg);
    expect(text).toContain('presentation.build (main only): Builds a presentation');
    expect(text).toContain('name: string — script name');
  });
});

describe('parseDoRequest', () => {
  it("'x.y {\"a\":1}' direct with params", () => {
    const reg = createRegistry([cap({ id: 'x.y' })]);
    const r = parseDoRequest('x.y {"a":1}', reg);
    expect(r).toEqual({ kind: 'direct', id: 'x.y', params: { a: 1 } });
  });

  it("'x.y' direct with {}", () => {
    const reg = createRegistry([cap({ id: 'x.y' })]);
    const r = parseDoRequest('x.y', reg);
    expect(r).toEqual({ kind: 'direct', id: 'x.y', params: {} });
  });

  it('bad JSON error', () => {
    const reg = createRegistry([cap({ id: 'x.y' })]);
    const r = parseDoRequest('x.y {not json}', reg);
    expect(r.kind).toBe('error');
  });

  it('unregistered id or free text is ask', () => {
    const reg = createRegistry([cap({ id: 'x.y' })]);
    expect(parseDoRequest('z.q {}', reg)).toEqual({ kind: 'ask', request: 'z.q {}' });
    expect(parseDoRequest('open the export menu', reg)).toEqual({ kind: 'ask', request: 'open the export menu' });
  });
});

describe('askCapability', () => {
  it('parses {capability,params} from a stubbed AskFn', async () => {
    const reg = createRegistry([cap()]);
    const ask: AskFn = vi.fn(async () => ({ content: JSON.stringify({ capability: 'script.run', params: { name: 'x' } }), thinking: null }));
    const r = await askCapability(ask, reg, 'run the export script');
    expect(r).toEqual({ id: 'script.run', params: { name: 'x' } });
  });

  it('throws when capability missing', async () => {
    const reg = createRegistry([cap()]);
    const ask: AskFn = vi.fn(async () => ({ content: JSON.stringify({ params: {} }), thinking: null }));
    await expect(askCapability(ask, reg, 'do something')).rejects.toThrow('AI reply named no capability');
  });
});
