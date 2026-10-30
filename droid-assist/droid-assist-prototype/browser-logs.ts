import type { ConsoleLevel, ConsoleLogPayload } from './main-bridge-protocol.js';

/** Which app a console line came from. */
export type LogApp = 'droid-new' | 'droid-main';

/** One browser console line of either app. */
export interface BrowserLog {
  id: string;
  time: number;
  app: LogApp;
  level: ConsoleLevel;
  message: string;
  /** How many times the same line repeated. */
  count: number;
}

/** Most browser log lines kept (newest first). */
export const BROWSER_LOG_LIMIT = 200;
/** Log source of browser log lines in the engine log. */
export const BROWSER_LOGS_SOURCE = 'Browser logs';

let seq = 0;

/** Adds a line; a repeat of the newest line of the same app and level only bumps its count. */
export function pushBrowserLog(list: readonly BrowserLog[], entry: Omit<BrowserLog, 'id' | 'count'>): BrowserLog[] {
  const head = list[0];
  if (head && head.app === entry.app && head.level === entry.level && head.message === entry.message) return [{ ...head, time: entry.time, count: head.count + 1 }, ...list.slice(1)];
  seq += 1;
  return [{ ...entry, id: `blog-${seq}`, count: 1 }, ...list].slice(0, BROWSER_LOG_LIMIT);
}

/** A console_log from droid-main as a browser log line (the app is always droid-main: it came over the bridge). */
export const fromConsolePayload = (p: ConsoleLogPayload, time = Date.now()): Omit<BrowserLog, 'id' | 'count'> => ({ app: 'droid-main', level: p.level, message: p.message, time });

/** The errors only, for agents to detect and fix. */
export const errorLogs = (list: readonly BrowserLog[]) => list.filter((l) => l.level === 'error');

const argText = (a: unknown): string => {
  if (a instanceof Error) return a.message;
  if (typeof a === 'string') return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
};

/** One console line from console.* arguments. */
export const consoleText = (args: readonly unknown[]) => args.map(argText).join(' ');

/** What the capture hooks: a console and a window's error events. */
export interface CaptureTarget {
  console: Pick<Console, 'error' | 'warn'>;
  addEventListener(type: 'error' | 'unhandledrejection', fn: (e: Event) => void): void;
  removeEventListener(type: 'error' | 'unhandledrejection', fn: (e: Event) => void): void;
}

const eventText = (e: Event): string => {
  const ev = e as Event & { message?: string; reason?: unknown };
  if (e.type === 'unhandledrejection') return `Unhandled rejection: ${argText(ev.reason)}`;
  return ev.message || 'Uncaught error';
};

/**
 * Captures droid-new's console.error / console.warn and uncaught errors and rejections; the
 * original console methods still run. Returns the uninstaller.
 */
export function captureConsole(target: CaptureTarget, onLog: (level: ConsoleLevel, message: string) => void): () => void {
  const original = { error: target.console.error, warn: target.console.warn };
  const wrap = (level: 'error' | 'warn') => (...args: unknown[]) => {
    original[level].apply(target.console, args);
    onLog(level, consoleText(args));
  };
  target.console.error = wrap('error');
  target.console.warn = wrap('warn');
  const onEvent = (e: Event) => onLog('error', eventText(e));
  target.addEventListener('error', onEvent);
  target.addEventListener('unhandledrejection', onEvent);
  return () => {
    target.console.error = original.error;
    target.console.warn = original.warn;
    target.removeEventListener('error', onEvent);
    target.removeEventListener('unhandledrejection', onEvent);
  };
}
