import { describe, expect, it, vi } from 'vitest';
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
