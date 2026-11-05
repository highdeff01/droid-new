import { uid } from './planner.js';

/**
 * The user-habit profile: built from the commands the user approves, the operations they save
 * and the corrections they make; summarised into habits, goals and preferences that feed
 * planning and the suggestion list.
 */

/** Where a profile event came from. */
export type ProfileSignal = 'command' | 'saved' | 'correction';
export const PROFILE_SIGNALS: readonly ProfileSignal[] = ['command', 'saved', 'correction'];

export interface ProfileEvent {
  id: string;
  signal: ProfileSignal;
  /** The approved command, the saved operation's name, or what was corrected. */
  text: string;
  /** The operation (goal) it belongs to; '' when none. */
  operation: string;
  time: number;
}

/** A repeated habit or goal and how often it was seen. */
export interface Tally {
  text: string;
  count: number;
}

export interface ProfileSummary {
  habits: Tally[];
  goals: Tally[];
  preferences: string[];
}

/** Most events kept (newest first). */
export const PROFILE_LIMIT = 300;
/** Most habits, goals and preferences in a summary. */
export const SUMMARY_TOP = 5;

/** Records one event, newest first; an empty text is ignored. */
export function recordSignal(events: ProfileEvent[], signal: ProfileSignal, text: string, operation: string, time = Date.now()): ProfileEvent[] {
  const t = text.trim();
  if (!t) return events;
  return [{ id: uid('pe'), signal, text: t, operation: operation.trim(), time }, ...events].slice(0, PROFILE_LIMIT);
}

/** Counts `texts` case-insensitively (the newest spelling wins, as events are newest first), most frequent first, newest breaking ties. */
function tally(texts: string[]): Tally[] {
  const counts = new Map<string, Tally>();
  for (const text of texts) {
    const key = text.toLowerCase();
    const t = counts.get(key);
    if (t) t.count += 1;
    else counts.set(key, { text, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, SUMMARY_TOP);
}

/**
 * Habits are the approved commands, goals the operations commands ran toward and saved operations
 * name, preferences the newest distinct corrections.
 */
export function summarizeProfile(events: ProfileEvent[]): ProfileSummary {
  const of = (s: ProfileSignal) => events.filter((e) => e.signal === s);
  const goals = events.filter((e) => e.signal !== 'correction').map((e) => e.operation || (e.signal === 'saved' ? e.text : '')).filter(Boolean);
  return {
    habits: tally(of('command').map((e) => e.text)),
    goals: tally(goals),
    preferences: [...new Set(of('correction').map((e) => e.text))].slice(0, SUMMARY_TOP),
  };
}

/** The profile as planning context lines. */
export const profileLines = (s: ProfileSummary): string[] => [
  ...s.habits.map((h) => `[User habit] ${h.text} (×${h.count})`),
  ...s.goals.map((g) => `[User goal] ${g.text} (×${g.count})`),
  ...s.preferences.map((p) => `[User preference] ${p}`),
];

/** Suggestions for what to do next: frequent goals other than `current`, then the top habit. */
export function profileSuggestions(s: ProfileSummary, current: string): string[] {
  const now = current.trim().toLowerCase();
  const goals = s.goals.filter((g) => g.text.toLowerCase() !== now).slice(0, 2).map((g) => `You often work on "${g.text}" — plan it next?`);
  const habit = s.habits[0] ? [`Run your usual "${s.habits[0].text}" again?`] : [];
  return [...goals, ...habit];
}

/** True for a stored event with every required field. */
export function isProfileEvent(v: unknown): v is ProfileEvent {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return typeof e.id === 'string' && PROFILE_SIGNALS.includes(e.signal as ProfileSignal) && typeof e.text === 'string' && typeof e.operation === 'string' && typeof e.time === 'number';
}
