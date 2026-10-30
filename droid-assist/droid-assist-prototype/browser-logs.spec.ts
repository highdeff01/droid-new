import { describe, expect, it, vi } from 'vitest';
import { BROWSER_LOG_LIMIT, captureConsole, errorLogs, fromConsolePayload, pushBrowserLog, type BrowserLog, type CaptureTarget } from './browser-logs.js';

describe('browser logs', () => {
  describe('pushBrowserLog', () => {
    const entry = { time: 1, app: 'droid-new' as const, level: 'error' as const, message: 'boom' };

    it('prepends a new line', () => {
      const list = pushBrowserLog([], entry);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ app: 'droid-new', level: 'error', message: 'boom', count: 1 });
    });

    it('merges an identical repeat of the head into count 2', () => {
      const once = pushBrowserLog([], entry);
      const twice = pushBrowserLog(once, { ...entry, time: 2 });
      expect(twice).toHaveLength(1);
      expect(twice[0]).toMatchObject({ count: 2, time: 2 });
    });

    it('caps at BROWSER_LOG_LIMIT', () => {
      let list: BrowserLog[] = [];
      for (let i = 0; i < BROWSER_LOG_LIMIT + 10; i++) list = pushBrowserLog(list, { time: i, app: 'droid-new', level: 'error', message: `m${i}` });
      expect(list).toHaveLength(BROWSER_LOG_LIMIT);
      expect(list[0].message).toBe(`m${BROWSER_LOG_LIMIT + 9}`);
    });
  });

  it('fromConsolePayload maps to app droid-main', () => {
    const line = fromConsolePayload({ app: 'droid-main', level: 'warn', message: 'hi' }, 5);
    expect(line).toEqual({ app: 'droid-main', level: 'warn', message: 'hi', time: 5 });
  });

  it('errorLogs filters to errors', () => {
    const list: BrowserLog[] = [
      { id: '1', time: 1, app: 'droid-new', level: 'error', message: 'e', count: 1 },
      { id: '2', time: 2, app: 'droid-new', level: 'warn', message: 'w', count: 1 },
    ];
    expect(errorLogs(list)).toEqual([list[0]]);
  });

  describe('captureConsole', () => {
    const makeTarget = () => {
      const listeners = new Map<string, (e: Event) => void>();
      const target: CaptureTarget = {
        console: { error: vi.fn(), warn: vi.fn() },
        addEventListener: (type, fn) => listeners.set(type, fn),
        removeEventListener: (type, fn) => {
          if (listeners.get(type) === fn) listeners.delete(type);
        },
      };
      return { target, listeners };
    };

    it('reports console.error and still calls the original', () => {
      const { target } = makeTarget();
      const originalError = target.console.error;
      const onLog = vi.fn();
      captureConsole(target, onLog);
      target.console.error('a', new Error('b'));
      expect(onLog).toHaveBeenCalledWith('error', 'a b');
      expect(originalError).toHaveBeenCalledWith('a', new Error('b'));
    });

    it('reports an unhandledrejection event as an error line starting "Unhandled rejection"', () => {
      const { target, listeners } = makeTarget();
      const onLog = vi.fn();
      captureConsole(target, onLog);
      const event = { type: 'unhandledrejection', reason: new Error('x') } as unknown as Event;
      listeners.get('unhandledrejection')!(event);
      expect(onLog).toHaveBeenCalledWith('error', expect.stringMatching(/^Unhandled rejection/));
    });

    it('the uninstaller restores the originals and removes both listeners', () => {
      const { target, listeners } = makeTarget();
      const originalError = target.console.error;
      const originalWarn = target.console.warn;
      const uninstall = captureConsole(target, vi.fn());
      uninstall();
      expect(target.console.error).toBe(originalError);
      expect(target.console.warn).toBe(originalWarn);
      expect(listeners.has('error')).toBe(false);
      expect(listeners.has('unhandledrejection')).toBe(false);
    });
  });
});
