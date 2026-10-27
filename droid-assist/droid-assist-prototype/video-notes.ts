import type { Frame } from './types.js';
import { frameDistance } from './drift.js';
import { uid } from './planner.js';

/** Whole-frame distance above which a frame counts as a notable moment. */
export const NOTABLE_DISTANCE = 0.08;

/** One timestamped note: ms since playback started, and the screenshot of a notable moment. */
export interface VideoNote {
  offsetMs: number;
  text: string;
  screenshot?: string;
}

/** One watching session of a video. */
export interface VideoSession {
  id: string;
  title: string;
  started: number;
  notes: VideoNote[];
}

/** One entry of the knowledge store. */
export interface KnowledgeEntry {
  id: string;
  kind: 'video';
  title: string;
  time: number;
  notes: VideoNote[];
}

/** A fresh session for `title` starting at `now`. */
export const startSession = (title: string, now = Date.now()): VideoSession => ({ id: uid('video'), title: title.trim(), started: now, notes: [] });

/** Whether `cur` differs from `prev` enough to be a notable moment (the first frame never is). */
export const notableMoment = (prev: Frame | null, cur: Frame, threshold = NOTABLE_DISTANCE) => !!prev && frameDistance(prev.data, cur.data) > threshold;

/** Appends a note at `now`; offsets never go backwards, so notes stay in playback order. */
export function addNote(s: VideoSession, text: string, now: number, screenshot?: string): VideoSession {
  const last = s.notes[s.notes.length - 1]?.offsetMs ?? 0;
  const offsetMs = Math.max(last, now - s.started);
  return { ...s, notes: [...s.notes, { offsetMs, text: text.trim(), ...(screenshot ? { screenshot } : {}) }] };
}

/** `ms` as m:ss. */
export function timestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The session as a knowledge-store entry. */
export const toKnowledge = (s: VideoSession): KnowledgeEntry => ({ id: s.id, kind: 'video', title: s.title, time: s.started, notes: s.notes });

/** One-line text of a session for the log. */
export const sessionText = (s: VideoSession) => `Video notes "${s.title}": ${s.notes.length} note(s), ${s.notes.filter((n) => n.screenshot).length} screenshot(s)${s.notes.length ? ` — ${s.notes.map((n) => `[${timestamp(n.offsetMs)}] ${n.text}`).join('; ')}` : ''}`;
