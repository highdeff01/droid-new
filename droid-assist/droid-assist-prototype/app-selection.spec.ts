import { describe, expect, it, vi } from 'vitest';
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

import {
  APP_SELECTION_SOURCE,
  decideApp,
  selectApp,
  standingCapabilities,
  type AppCapability,
  type Job,
} from './app-selection.js';

const capability = (overrides: Partial<AppCapability> = {}): AppCapability => ({
  calculate: true,
  perform: true,
  calculateCost: 1,
  performCost: 1,
  ...overrides,
});

const job = (overrides: Partial<Job> = {}): Job => ({
  name: 'index the repo',
  apps: {
    assist: capability(),
    main: capability(),
  },
  ...overrides,
});

describe('app selection', () => {
  describe('decideApp', () => {
    it('picks the single cheaper app for both phases', () => {
      const d = decideApp(
        job({
          apps: {
            assist: capability({ calculateCost: 1, performCost: 1 }),
            main: capability({ calculateCost: 5, performCost: 5 }),
          },
        }),
      );
      expect(d.choice).toBe('assist');
      expect(d.calculate).toBe('assist');
      expect(d.perform).toBe('assist');
    });

    it('splits when the cheaper app differs per phase', () => {
      const d = decideApp(
        job({
          apps: {
            assist: capability({ calculateCost: 1, performCost: 5 }),
            main: capability({ calculateCost: 5, performCost: 1 }),
          },
        }),
      );
      expect(d.choice).toBe('split');
      expect(d.calculate).toBe('assist');
      expect(d.perform).toBe('main');
    });

    it('routes to both apps when needsBoth is set', () => {
      const d = decideApp(job({ needsBoth: true }));
      expect(d.choice).toBe('both');
      expect(d.reason).toContain('both apps needed');
    });

    it('breaks a cost tie in favor of assist, the boss', () => {
      const d = decideApp(
        job({
          apps: {
            assist: capability({ calculateCost: 3, performCost: 3 }),
            main: capability({ calculateCost: 3, performCost: 3 }),
          },
        }),
      );
      expect(d.choice).toBe('assist');
      expect(d.calculate).toBe('assist');
      expect(d.perform).toBe('assist');
    });

    it('hands a phase neither app can do to assist, the boss', () => {
      const d = decideApp(
        job({
          apps: {
            assist: capability({ perform: false }),
            main: capability({ perform: false }),
          },
        }),
      );
      expect(d.perform).toBe('assist');
      expect(d.reason).toContain('boss');
    });
  });

  describe('selectApp', () => {
    it('logs exactly once with the app-selection source', () => {
      const log = vi.fn();
      selectApp(job(), log);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(APP_SELECTION_SOURCE, expect.any(String));
    });

    it('logs a line naming the job and the choice: droid-new', () => {
      const log = vi.fn();
      selectApp(
        job({
          name: 'review the diff',
          apps: {
            assist: capability({ calculateCost: 1, performCost: 1 }),
            main: capability({ calculateCost: 5, performCost: 5 }),
          },
        }),
        log,
      );
      const [, line] = log.mock.calls[0] as [string, string];
      expect(line).toContain('review the diff');
      expect(line).toContain('droid-new');
    });

    it('logs a line naming the job and the choice: droid-main', () => {
      const log = vi.fn();
      selectApp(
        job({
          name: 'mirror the preview',
          apps: {
            assist: capability({ calculateCost: 5, performCost: 5 }),
            main: capability({ calculateCost: 1, performCost: 1 }),
          },
        }),
        log,
      );
      const [, line] = log.mock.calls[0] as [string, string];
      expect(line).toContain('mirror the preview');
      expect(line).toContain('droid-main');
    });

    it('logs a line naming the job and the choice: split', () => {
      const log = vi.fn();
      selectApp(
        job({
          name: 'plan and apply the fix',
          apps: {
            assist: capability({ calculateCost: 1, performCost: 5 }),
            main: capability({ calculateCost: 5, performCost: 1 }),
          },
        }),
        log,
      );
      const [, line] = log.mock.calls[0] as [string, string];
      expect(line).toContain('plan and apply the fix');
      expect(line).toContain('split');
    });

    it('logs a line naming the job and the choice: both', () => {
      const log = vi.fn();
      selectApp(job({ name: 'cross-app check', needsBoth: true }), log);
      const [, line] = log.mock.calls[0] as [string, string];
      expect(line).toContain('cross-app check');
      expect(line).toContain('both');
    });
  });

  describe('standingCapabilities', () => {
    it('disconnected main is incapable of both phases', () => {
      const caps = standingCapabilities({ armed: true, aiOnline: true, mainConnected: false });
      expect(caps.main.calculate).toBe(false);
      expect(caps.main.perform).toBe(false);
    });

    it('disarmed assist cannot perform', () => {
      const caps = standingCapabilities({ armed: false, aiOnline: true, mainConnected: true });
      expect(caps.assist.perform).toBe(false);
    });

    it('disarmed assist with online AI and connected main splits: calculate assist, perform main', () => {
      const caps = standingCapabilities({ armed: false, aiOnline: true, mainConnected: true });
      const d = decideApp(job({ apps: caps }));
      expect(d.choice).toBe('split');
      expect(d.calculate).toBe('assist');
      expect(d.perform).toBe('main');
    });
  });
});
