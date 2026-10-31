import { describe, expect, it } from 'vitest';
import { HEALTH_STALE_MS, capabilitiesFromHealth, fromHealthPayload, healthAppId, healthCost, healthLine, isFresh, isHealthy, jobFromHealth, localHealth, toHealthPayload, type Health } from './health.js';

const health = (app: 'droid-new' | 'droid-main', patch: Partial<Health> = {}, at = 1000): Health => ({ app, aiUp: true, latencyMs: 100, crewLoad: 0.1, armed: true, canExecute: true, at, ...patch });

describe('localHealth / payload round trip', () => {
  it('measures local health and survives the wire unchanged', () => {
    const h = localHealth('droid-new', { aiUp: true, latencyMs: 50, crewLoad: 0.2, armed: false, canExecute: true }, 7);
    const back = fromHealthPayload(toHealthPayload(h), 9);
    expect(back).toEqual({ ...h, at: 9 });
  });

  it('coerces an unknown app to droid-new on the wire', () => {
    expect(fromHealthPayload({ app: 'x' as never, aiUp: true, latencyMs: 1, crewLoad: 0, armed: true, canExecute: true }, 1).app).toBe('droid-new');
  });
});

describe('isFresh / isHealthy', () => {
  it('treats a report older than the window as stale', () => {
    const h = health('droid-main', {}, 1000);
    expect(isFresh(h, 1000 + HEALTH_STALE_MS)).toBe(true);
    expect(isFresh(h, 1000 + HEALTH_STALE_MS + 1)).toBe(false);
    expect(isFresh(null)).toBe(false);
  });

  it('is healthy only when fresh, AI up and able to execute', () => {
    const now = 1000;
    expect(isHealthy(health('droid-new', {}, now), now)).toBe(true);
    expect(isHealthy(health('droid-new', { aiUp: false }, now), now)).toBe(false);
    expect(isHealthy(health('droid-new', { canExecute: false }, now), now)).toBe(false);
    expect(isHealthy(health('droid-new', {}, now - HEALTH_STALE_MS - 1), now)).toBe(false);
  });
});

describe('healthCost', () => {
  it('is infinite for a stale app and for one that cannot execute', () => {
    expect(healthCost(health('droid-main', {}, 0), 1_000_000)).toBe(Number.POSITIVE_INFINITY);
    expect(healthCost(health('droid-main', { canExecute: false }), 1000)).toBe(Number.POSITIVE_INFINITY);
  });

  it('rises with latency and crew load, and rises sharply past the slow threshold', () => {
    const fast = healthCost(health('droid-new', { latencyMs: 100, crewLoad: 0 }, 1000), 1000);
    const slow = healthCost(health('droid-new', { latencyMs: 2000, crewLoad: 0 }, 1000), 1000);
    expect(slow).toBeGreaterThan(fast + 1000);
  });
});

describe('capabilitiesFromHealth', () => {
  it('marks a stale or unhealthy app incapable in both phases', () => {
    const now = 1000;
    const caps = capabilitiesFromHealth({ assist: health('droid-new', {}, now), main: null }, now);
    expect(caps.assist.calculate).toBe(true);
    expect(caps.main.calculate).toBe(false);
    expect(caps.main.perform).toBe(false);
  });

  it('only lets an armed app perform', () => {
    const caps = capabilitiesFromHealth({ assist: health('droid-new', { armed: false }), main: null }, 1000);
    expect(caps.assist.calculate).toBe(true);
    expect(caps.assist.perform).toBe(false);
  });

  it('feeds app selection through jobFromHealth', () => {
    const now = Date.now();
    const job = jobFromHealth('open settings', { assist: health('droid-new', {}, now), main: health('droid-main', {}, now) }, true);
    expect(job.needsBoth).toBe(true);
    expect(job.apps.assist.calculate).toBe(true);
  });
});

describe('healthLine / healthAppId', () => {
  it('reads the health as one line', () => {
    expect(healthLine(health('droid-main', { latencyMs: 120, crewLoad: 0.2, armed: false }))).toBe('droid-main: AI up, 120ms, crew load 20%, input disarmed');
  });

  it('maps the app to its selection id', () => {
    expect(healthAppId('droid-new')).toBe('assist');
    expect(healthAppId('droid-main')).toBe('main');
  });
});
