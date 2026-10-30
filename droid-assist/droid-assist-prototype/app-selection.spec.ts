import { describe, expect, it } from 'vitest';
import {
  AI_CALL_COST,
  ARBITER,
  LOAD_COST,
  MEMORY_CREDIT,
  appCost,
  decisionText,
  emptyTally,
  selectApps,
  type AppDecision,
  type AppProfile,
  type AppTally,
  type JointOperation,
} from './app-selection.js';

const profile = (overrides: Partial<AppProfile> = {}): AppProfile => ({
  app: 'droid-new',
  connected: true,
  capabilities: ['cap'],
  load: 0,
  aiCalls: 1,
  latencyMs: 100,
  ...overrides,
});

const op = (overrides: Partial<JointOperation> = {}): JointOperation => ({
  name: 'Save file',
  capability: 'cap',
  target: 'droid-new',
  crossApp: false,
  ...overrides,
});

describe('selectApps', () => {
  it('a cheaper droid-main calculates while the target app, droid-new, performs — mode split', () => {
    const profiles = [profile({ app: 'droid-new', aiCalls: 2, latencyMs: 300 }), profile({ app: 'droid-main', aiCalls: 1, latencyMs: 100 })];
    const result = selectApps(op({ target: 'droid-new' }), profiles);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.calculate).toBe('droid-main');
    expect(result.decision.perform).toBe('droid-new');
    expect(result.decision.mode).toBe('split');
  });

  it('equal costs are tie-broken to the arbiter, droid-new', () => {
    const profiles = [profile({ app: 'droid-new' }), profile({ app: 'droid-main' })];
    const result = selectApps(op(), profiles);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision.calculate).toBe('droid-new');
  });

  it('a disconnected app is never chosen even when it would be cheaper', () => {
    const profiles = [profile({ app: 'droid-new', aiCalls: 1, latencyMs: 100 }), profile({ app: 'droid-main', connected: false, aiCalls: 0, latencyMs: 0 })];
    const result = selectApps(op(), profiles);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision.calculate).toBe('droid-new');
  });

  it('falls back to the calculating app to perform when the target lacks the capability, and says so', () => {
    const profiles = [profile({ app: 'droid-new', capabilities: ['cap'] }), profile({ app: 'droid-main', capabilities: ['other'] })];
    const result = selectApps(op({ target: 'droid-main' }), profiles);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.perform).toBe('droid-new');
    expect(result.decision.reason).toContain('lacks');
  });

  it('refuses the operation naming each app\'s problem when none fits', () => {
    const profiles = [profile({ app: 'droid-new', connected: false }), profile({ app: 'droid-main', capabilities: [] })];
    const result = selectApps(op(), profiles);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('droid-new is not connected');
    expect(result.reason).toContain('droid-main lacks');
  });

  it('crossApp operations are placed in mode "both"', () => {
    const profiles = [profile({ app: 'droid-new' }), profile({ app: 'droid-main' })];
    const result = selectApps(op({ crossApp: true }), profiles);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision.mode).toBe('both');
  });

  it('a memory tally of successes on droid-main makes it win over an otherwise slightly cheaper droid-new', () => {
    const profiles = [profile({ app: 'droid-new', aiCalls: 1, latencyMs: 100 }), profile({ app: 'droid-main', aiCalls: 1, latencyMs: 200 })];
    const withoutMemory = selectApps(op(), profiles);
    expect(withoutMemory.ok && withoutMemory.decision.calculate).toBe('droid-new');
    const memory: AppTally = { 'droid-new': { ok: 0, failed: 1 }, 'droid-main': { ok: 1, failed: 0 } };
    const result = selectApps(op(), profiles, memory);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision.calculate).toBe('droid-main');
  });

  it('the reason starts with the arbiter statement and names the cost of each candidate', () => {
    const profiles = [profile({ app: 'droid-new' }), profile({ app: 'droid-main' })];
    const result = selectApps(op(), profiles);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.reason.startsWith(`${ARBITER} arbitrates`)).toBe(true);
    expect(result.decision.reason).toContain('AI call(s)');
  });
});

describe('appCost', () => {
  it('sums AI-call, latency, load and memory-credit cost', () => {
    const p = profile({ aiCalls: 2, latencyMs: 300, load: 0.4 });
    const memory: AppTally = emptyTally();
    memory['droid-new'] = { ok: 1, failed: 3 };
    expect(appCost(p, memory)).toBe(2 * AI_CALL_COST + 300 + 0.4 * LOAD_COST + (3 - 1) * MEMORY_CREDIT);
  });

  it('a higher load costs more', () => {
    const memory = emptyTally();
    const low = appCost(profile({ load: 0.1 }), memory);
    const high = appCost(profile({ load: 0.9 }), memory);
    expect(high).toBeGreaterThan(low);
  });
});

describe('decisionText', () => {
  it('contains the operation name and the mode', () => {
    const decision: AppDecision = { operation: 'Save file', calculate: 'droid-new', perform: 'droid-main', mode: 'split', reason: 'because' };
    const text = decisionText(decision);
    expect(text).toContain('Save file');
    expect(text).toContain('split');
  });
});
