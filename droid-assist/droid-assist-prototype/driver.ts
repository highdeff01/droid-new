/**
 * Who is driving: with both apps holding admin status, droid-new is the boss and owns execution by
 * default. When droid-main issues a command at the same time — while droid-new is driving — it does
 * not take effect: it becomes a queued suggestion for droid-new to accept or dismiss. The wheel
 * passes to droid-main only when droid-new hands it over (a takeover) or accepts a suggestion.
 */
import type { RegulateCommand } from './main-bridge-protocol.js';

/** The app that can hold execution. */
export type Driver = 'droid-new' | 'droid-main';
/** The boss: it drives unless it hands the wheel over. */
export const BOSS: Driver = 'droid-new';
/** Display name of each driver. */
export const DRIVER_NAMES: Readonly<Record<Driver, string>> = { 'droid-new': 'droid-new', 'droid-main': 'droid-main' };
/** Log source of every driving line. */
export const DRIVING_SOURCE = 'Driving';

/** Who owns execution right now, since when, and why. */
export interface Driving {
  driver: Driver;
  since: number;
  reason: string;
}

/** A command droid-main issued while droid-new was driving, held for droid-new to accept or dismiss. */
export interface Suggestion {
  id: string;
  from: Driver;
  command: RegulateCommand;
  mode?: string;
  reason: string;
  time: number;
}

/** The initial state: droid-new drives, because it is the boss. */
export const newDriving = (now = Date.now()): Driving => ({ driver: BOSS, since: now, reason: 'droid-new is the boss and holds admin status' });

/** droid-new takes (or takes back) the wheel. */
export const takeWheel = (reason: string, now = Date.now()): Driving => ({ driver: BOSS, since: now, reason });

/** The wheel passes to droid-main (it took over a step). */
export const handWheel = (reason: string, now = Date.now()): Driving => ({ driver: 'droid-main', since: now, reason });

/** Whether `from` is the app currently driving; a command from the driver applies at once. */
export const isDriving = (d: Driving, from: Driver): boolean => d.driver === from;

/** Whether a command from `from` is simultaneous — issued while the other app is driving. */
export const isSimultaneous = (d: Driving, from: Driver): boolean => !isDriving(d, from);

let seq = 0;

/** Queues a simultaneous command as a suggestion (newest first), never applying it. */
export function enqueueSuggestion(queue: readonly Suggestion[], command: RegulateCommand, mode: string | undefined, reason: string, now = Date.now()): Suggestion[] {
  seq += 1;
  const next: Suggestion = { id: `sug-${now.toString(36)}-${seq}`, from: 'droid-main', command, ...(mode ? { mode } : {}), reason, time: now };
  return [next, ...queue];
}

/** The queue with suggestion `id` removed, and the suggestion that was removed (or null). */
export function takeSuggestion(queue: readonly Suggestion[], id: string): { queue: Suggestion[]; taken: Suggestion | null } {
  const taken = queue.find((s) => s.id === id) ?? null;
  return { queue: queue.filter((s) => s.id !== id), taken };
}

/** The log line of a queued suggestion. */
export const suggestionLine = (s: Suggestion): string =>
  `droid-main suggested "${s.command}${s.mode ? ` → ${s.mode}` : ''}" while droid-new was driving — queued for droid-new to accept or dismiss${s.reason ? ` (${s.reason})` : ''}`;

/** The log line of the driving flag changing. */
export const drivingLine = (d: Driving): string => `Now driving: ${DRIVER_NAMES[d.driver]} — ${d.reason}`;

/** The one-line flag for the UI: who owns execution. */
export const drivingFlag = (d: Driving): string => `Driving: ${DRIVER_NAMES[d.driver]}`;
