import { uid } from './planner.js';

/** Target of a user note that goes to every project. */
export const ALL_PROJECTS = '*';

/** A note the user added in the dashboard: knowledge for one project (its goal text) or all of them. */
export interface UserNote {
  id: string;
  time: number;
  text: string;
  /** Project id (trimmed goal text) or ALL_PROJECTS. */
  project: string;
  /** Projects whose AI call already received this note. */
  injectedInto: string[];
}

/** localStorage key of the knowledge store. */
export const KNOWLEDGE_KEY = 'droid-assist.knowledge';
/** Most user notes kept. */
export const KNOWLEDGE_LIMIT = 200;

const isNote = (v: unknown): v is UserNote => {
  const n = v as UserNote;
  return !!n && typeof n === 'object' && typeof n.id === 'string' && Number.isFinite(n.time) && typeof n.text === 'string' && !!n.text.trim()
    && typeof n.project === 'string' && Array.isArray(n.injectedInto) && n.injectedInto.every((p) => typeof p === 'string');
};

/** The stored user notes, newest first; invalid ones are dropped. */
export function loadKnowledge(storage: Pick<Storage, 'getItem'> = localStorage): UserNote[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KNOWLEDGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isNote).slice(0, KNOWLEDGE_LIMIT) : [];
  } catch {
    return [];
  }
}

/** Persists the newest KNOWLEDGE_LIMIT notes; returns them. */
export function saveKnowledge(notes: UserNote[], storage: Pick<Storage, 'setItem'> = localStorage): UserNote[] {
  const kept = notes.slice(0, KNOWLEDGE_LIMIT);
  try {
    storage.setItem(KNOWLEDGE_KEY, JSON.stringify(kept));
  } catch {
    // Storage full or unavailable: keep the in-memory notes.
  }
  return kept;
}

/** Prepends a note for `project` (ALL_PROJECTS for every one); blank text leaves the notes unchanged. */
export function addUserNote(notes: UserNote[], text: string, project: string, now = Date.now()): UserNote[] {
  const body = text.trim();
  if (!body) return notes;
  return [{ id: uid('note'), time: now, text: body, project: project.trim() || ALL_PROJECTS, injectedInto: [] }, ...notes];
}

/** Notes targeting `project` (or all projects) that its AI calls have not received yet, oldest first. */
export function pendingNotesFor(notes: UserNote[], project: string): UserNote[] {
  return notes.filter((n) => (n.project === ALL_PROJECTS || n.project === project) && !n.injectedInto.includes(project)).reverse();
}

/** Marks `ids` as injected into `project`. */
export function markInjected(notes: UserNote[], ids: readonly string[], project: string): UserNote[] {
  return notes.map((n) => (ids.includes(n.id) && !n.injectedInto.includes(project) ? { ...n, injectedInto: [...n.injectedInto, project] } : n));
}

/** The AI context line of a user note. */
export const noteLine = (n: UserNote) => `User note: ${n.text}`;
