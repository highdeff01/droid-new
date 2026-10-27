import { describe, expect, it, vi } from 'vitest';
import { LIVE_SETTINGS, applyLiveSetting, capabilityLine, capabilityPrompt, createRegistry, permission, validateParams, type Capability, type InvocationRecord, type Requester } from './capabilities.js';
import { DEFAULT_SETTINGS } from './use-assist.js';

const user: Requester = { kind: 'user' };
const ai: Requester = { kind: 'ai' };
const screenAgent: Requester = { kind: 'agent', agent: 'screen' };
const subagents: Requester = { kind: 'agent', agent: 'subagents' };
const mainApp: Requester = { kind: 'main-app' };

const arm: Capability = { id: 'guard.arm', description: 'Arm real input', params: {}, guardrail: true, invoke: () => 'armed' };
const snip: Capability = { id: 'snip', description: 'Crop the live frame', params: { x: { type: 'number', description: 'left', required: true, min: 0, max: 1 }, label: { type: 'string', description: 'label' } }, readOnly: true, invoke: (p) => `snipped at ${p.x}` };
const watcher: Capability = { id: 'stage.screenWatcher', description: 'Toggle the screen watcher', params: { on: { type: 'boolean', description: 'on', required: true } }, stage: 'screenWatcher', invoke: (p) => `watcher ${p.on ? 'on' : 'off'}` };
const mode: Capability = { id: 'monitor.mode', description: 'Set the monitor mode', params: { mode: { type: 'string', description: 'mode', values: ['app', 'background'], required: true } }, invoke: (p) => String(p.mode) };
const broken: Capability = { id: 'broken', description: 'Always fails', params: {}, invoke: () => { throw new Error('no frame yet'); } };

describe('permission', () => {
  it('lets the user invoke anything, guardrails included', () => {
    expect(permission(arm, user)).toBeNull();
    expect(permission(watcher, user)).toBeNull();
  });

  it('denies guardrails to the AI, every agent and the main app', () => {
    for (const r of [ai, screenAgent, subagents, mainApp]) expect(permission(arm, r)).toMatch(/guardrail/);
  });

  it('lets an agent invoke its own stage but not another agent\'s', () => {
    expect(permission(watcher, screenAgent)).toBeNull();
    expect(permission(watcher, subagents)).toMatch(/agent:subagents may not invoke "stage.screenWatcher".*Screen watcher/);
    expect(permission(watcher, mainApp)).toMatch(/main-app may not invoke/);
  });

  it('lets the AI run loop-control stages and any agent run stage-less features', () => {
    expect(permission(watcher, ai)).toBeNull();
    expect(permission(snip, subagents)).toBeNull();
    expect(permission(mode, mainApp)).toBeNull();
  });
});

describe('validateParams', () => {
  it('accepts params that fit, with optional ones absent', () => {
    expect(validateParams(snip, { x: 0.5 })).toBeNull();
    expect(validateParams(snip, { x: 1, label: 'button' })).toBeNull();
  });

  it('rejects unknown, missing, mistyped, out-of-range and out-of-set params', () => {
    expect(validateParams(snip, { x: 0.5, y: 1 })).toMatch(/unknown parameter "y"/);
    expect(validateParams(snip, {})).toMatch(/missing parameter "x"/);
    expect(validateParams(snip, { x: '0.5' })).toMatch(/"x" must be a number/);
    expect(validateParams(snip, { x: 2 })).toMatch(/within 0..1/);
    expect(validateParams(mode, { mode: 'advanced' })).toMatch(/one of app, background/);
  });
});

describe('createRegistry', () => {
  const setup = () => {
    const log: InvocationRecord[] = [];
    const registry = createRegistry([arm, snip, watcher, mode, broken], (r) => log.push(r));
    return { log, registry };
  };

  it('runs a permitted request and logs requester, params and result', async () => {
    const { log, registry } = setup();
    const r = await registry.invoke('snip', { x: 0.25 }, subagents);
    expect(r).toMatchObject({ ok: true, result: 'snipped at 0.25', requester: 'agent:subagents', id: 'snip', params: { x: 0.25 } });
    expect(log).toEqual([r]);
  });

  it('refuses without running and still logs the refusal', async () => {
    const { log, registry } = setup();
    const spy = vi.spyOn(arm, 'invoke');
    const r = await registry.invoke('guard.arm', {}, ai);
    expect(r).toMatchObject({ ok: false, requester: 'ai', result: expect.stringMatching(/guardrail/) });
    expect(spy).not.toHaveBeenCalled();
    expect(log).toHaveLength(1);
  });

  it('reports an unknown capability, bad params and a failing feature as failed records', async () => {
    const { log, registry } = setup();
    expect(await registry.invoke('teleport', {}, user)).toMatchObject({ ok: false, result: 'unknown capability "teleport"' });
    expect(await registry.invoke('monitor.mode', { mode: 'loud' }, user)).toMatchObject({ ok: false, result: expect.stringMatching(/one of/) });
    expect(await registry.invoke('broken', {}, user)).toMatchObject({ ok: false, result: 'no frame yet' });
    expect(log.map((l) => l.ok)).toEqual([false, false, false]);
  });

  it('gives buttons (the user) and the AI the same invoke function', async () => {
    const { registry } = setup();
    const a = await registry.invoke('stage.screenWatcher', { on: false }, user);
    const b = await registry.invoke('stage.screenWatcher', { on: false }, ai);
    expect([a.result, b.result]).toEqual(['watcher off', 'watcher off']);
  });
});

describe('capabilityPrompt', () => {
  it('lists one compact line per capability the requester may invoke', () => {
    expect(capabilityLine(snip)).toBe('snip(x:number,label?:string) — Crop the live frame [read-only]');
    expect(capabilityLine(mode)).toBe('monitor.mode(mode:app|background) — Set the monitor mode');
    const prompt = capabilityPrompt([arm, snip, watcher], ai);
    expect(prompt.split('\n')).toHaveLength(2);
    expect(prompt).not.toMatch(/guard\.arm/);
  });
});

describe('applyLiveSetting', () => {
  it('applies an in-range cadence, retry count, monitor mode and view resolution', () => {
    const cases: Array<[string, unknown]> = [['captureMs', 1000], ['stepRetries', LIVE_SETTINGS.stepRetries.max], ['monitorMode', 'advanced'], ['aiView', '1280x720'], ['watchMs', 2000], ['maxIterations', 1]];
    for (const [key, value] of cases) {
      const r = applyLiveSetting(DEFAULT_SETTINGS, key, value);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.settings).toEqual({ ...DEFAULT_SETTINGS, [key]: value });
    }
  });

  it('logs the old and new value', () => {
    const r = applyLiveSetting({ ...DEFAULT_SETTINGS, captureMs: 500 }, 'captureMs', 750);
    expect(r.message).toBe('captureMs: 500 → 750');
  });

  it('rejects out-of-range values instead of clamping, and keys that are not live settings', () => {
    expect(applyLiveSetting(DEFAULT_SETTINGS, 'captureMs', 10)).toMatchObject({ ok: false, message: expect.stringMatching(/within 250..2000/) });
    expect(applyLiveSetting(DEFAULT_SETTINGS, 'monitorMode', 'turbo')).toMatchObject({ ok: false });
    expect(applyLiveSetting(DEFAULT_SETTINGS, 'aiView', '4k')).toMatchObject({ ok: false });
    expect(applyLiveSetting(DEFAULT_SETTINGS, 'actionBudget', 99)).toMatchObject({ ok: false, message: expect.stringMatching(/not a live setting/) });
  });
});
