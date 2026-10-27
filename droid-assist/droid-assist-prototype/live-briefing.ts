import type { ActionRecord, Frame, LogEntry } from './types.js';
import type { ThinkingEntry } from './thinking-timeline.js';

/** How an executed action ended, as the dashboard labels it. */
export type ActionOutcome = 'ok' | 'failed' | 'simulated' | 'dispatched';

/**
 * The outcome of an action: dispatched when the bridge accepted it but the effect was not confirmed,
 * failed when it did not succeed, simulated when it ran on the demo desktop, ok otherwise.
 */
export function outcomeOf(r: ActionRecord): ActionOutcome {
  if (r.dispatched) return 'dispatched';
  if (!r.ok) return 'failed';
  return r.via === 'demo' ? 'simulated' : 'ok';
}

/** The action history, most recent first. */
export const recentActions = (history: readonly ActionRecord[]) => [...history].sort((a, b) => b.time - a.time);

/** A key frame the main AI or an agent marked as worth showing. */
export interface PreferredShot {
  frame: Frame;
  /** Who marked it: 'Main AI' or an agent's name. */
  by: string;
  /** Why it was marked. */
  reason: string;
  time: number;
}

/** Most preferred shots kept. */
export const PREFERRED_LIMIT = 12;

/** Marks `frame` as preferred (newest first); re-marking a frame moves it to the front with the new reason. */
export function markPreferred(list: readonly PreferredShot[], frame: Frame, by: string, reason: string, now = Date.now()): PreferredShot[] {
  return [{ frame, by, reason, time: now }, ...list.filter((p) => p.frame.id !== frame.id)].slice(0, PREFERRED_LIMIT);
}

/** Sections of the notes stream. */
export type NoteSection = 'planning' | 'execution' | 'agents' | 'thinking' | 'user' | 'system';
export const NOTE_SECTIONS: readonly NoteSection[] = ['planning', 'execution', 'agents', 'thinking', 'user', 'system'];

/** Agent name of every Qwen thinking timeline entry. */
export const MAIN_AI = 'Main AI';

/** Section of a log entry by its source; a source not listed is 'system'. */
const SECTION_OF_SOURCE: Record<string, NoteSection> = {
  Planner: 'planning', 'AI help': 'planning', AI: 'planning', 'AI parse': 'planning', Patterns: 'planning', Library: 'planning', 'Goal reviewer': 'planning',
  Replay: 'execution', 'Auto-Actor': 'execution', 'Auto-continue': 'execution', Recorder: 'execution', 'Test click': 'execution', Verify: 'execution',
  'Verify real input': 'execution', '/move': 'execution', History: 'execution', Triggers: 'execution',
  'Screen watcher': 'agents', Supervisor: 'agents', 'Popup watcher': 'agents', 'Drift monitor': 'agents', 'Progress tracker': 'agents', 'Element identifier': 'agents',
  'Coordinate learner': 'agents', 'Agent bus': 'agents', 'Screen-change responder': 'agents', Habits: 'agents', Screen: 'agents',
  You: 'user', Dashboard: 'user', Knowledge: 'user',
};

/** The section a log source belongs to. */
export const sectionOf = (source: string): NoteSection => SECTION_OF_SOURCE[source] ?? 'system';

/** One entry of the running notes stream, pointing at the log or thinking entry it came from. */
export interface StreamNote {
  id: string;
  time: number;
  project: string;
  agent: string;
  section: NoteSection;
  text: string;
  ref: { kind: 'log' | 'thinking'; id: string };
}

const fromLog = (l: LogEntry): StreamNote => ({
  id: `log:${l.id}`, time: l.time, project: l.project ?? '', agent: l.source, section: sectionOf(l.source), text: l.message, ref: { kind: 'log', id: l.id },
});

const fromThinking = (e: ThinkingEntry): StreamNote => ({
  id: `thinking:${e.id}`, time: e.time, project: e.project ?? '', agent: MAIN_AI, section: 'thinking',
  text: `${e.step} — ${e.error ? `failed: ${e.error}` : e.text || '(no answer)'}`, ref: { kind: 'thinking', id: e.id },
});

/** The running notes stream from the activity log and the Qwen thinking timeline, newest first. */
export function notesStream(log: readonly LogEntry[], timeline: readonly ThinkingEntry[]): StreamNote[] {
  return [...log.map(fromLog), ...timeline.map(fromThinking)].sort((a, b) => b.time - a.time);
}

/** Notes filter; an unset field matches every note. */
export interface NoteFilter {
  project?: string;
  agent?: string;
  section?: NoteSection;
}

/** The notes matching every set field of `filter`. */
export function filterNotes(notes: readonly StreamNote[], filter: NoteFilter): StreamNote[] {
  return notes.filter((n) => (filter.project === undefined || n.project === filter.project)
    && (filter.agent === undefined || n.agent === filter.agent)
    && (filter.section === undefined || n.section === filter.section));
}

/** The distinct values of `key` across the notes, sorted, for the filter pickers. */
export const noteValues = (notes: readonly StreamNote[], key: 'project' | 'agent') => [...new Set(notes.map((n) => n[key]))].sort();
