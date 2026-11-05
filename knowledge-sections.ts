import { uid } from './planner.js';

/**
 * The sectioned knowledge store: info sectioned off per topic, project or agent. A section whose
 * name the operation mentions, that holds a note for that operation, or that belongs to the acting
 * agent is cross-referenced before the operation and injects its important, blacklisted and recent notes.
 */

export type SectionScope = 'topic' | 'project' | 'agent';
export const SECTION_SCOPES: readonly SectionScope[] = ['topic', 'project', 'agent'];

/** How a note is injected: always (important), as a method never to use (blacklist), or among the newest (recent). */
export type NoteTag = 'recent' | 'important' | 'blacklist';
export const NOTE_TAGS: readonly NoteTag[] = ['recent', 'important', 'blacklist'];

export interface SectionNote {
  id: string;
  text: string;
  tag: NoteTag;
  /** The one operation this note applies to; null applies wherever the section matches. */
  operation: string | null;
  time: number;
}

export interface KnowledgeSection {
  id: string;
  name: string;
  scope: SectionScope;
  /** Newest first. */
  notes: SectionNote[];
  created: number;
  updated: number;
}

/** Most sections kept, and most notes per section. */
export const SECTION_LIMIT = 100;
export const SECTION_NOTE_LIMIT = 100;
/** Newest recent notes injected per matched section. */
export const RECENT_INJECTED = 3;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Adds a section; a blank name or one already used (case-insensitively) leaves the list as is. */
export function createSection(list: KnowledgeSection[], name: string, scope: SectionScope, time = Date.now()): KnowledgeSection[] {
  const n = name.trim();
  if (!n || list.some((s) => norm(s.name) === norm(n))) return list;
  return [{ id: uid('sec'), name: n, scope, notes: [], created: time, updated: time }, ...list].slice(0, SECTION_LIMIT);
}

/** Renames a section; a blank name or one another section uses leaves the list as is. */
export function renameSection(list: KnowledgeSection[], id: string, name: string, time = Date.now()): KnowledgeSection[] {
  const n = name.trim();
  if (!n || list.some((s) => s.id !== id && norm(s.name) === norm(n))) return list;
  return list.map((s) => (s.id === id ? { ...s, name: n, updated: time } : s));
}

export const deleteSection = (list: KnowledgeSection[], id: string): KnowledgeSection[] => list.filter((s) => s.id !== id);

const patchNotes = (list: KnowledgeSection[], id: string, time: number, f: (notes: SectionNote[]) => SectionNote[]) =>
  list.map((s) => (s.id === id ? { ...s, notes: f(s.notes), updated: time } : s));

/** Adds a note to a section (newest first); an empty text is ignored. */
export function addSectionNote(list: KnowledgeSection[], id: string, note: { text: string; tag: NoteTag; operation?: string | null }, time = Date.now()): KnowledgeSection[] {
  const text = note.text.trim();
  if (!text) return list;
  const operation = note.operation?.trim() || null;
  return patchNotes(list, id, time, (notes) => [{ id: uid('sn'), text, tag: note.tag, operation, time }, ...notes].slice(0, SECTION_NOTE_LIMIT));
}

export const removeSectionNote = (list: KnowledgeSection[], id: string, noteId: string, time = Date.now()): KnowledgeSection[] =>
  patchNotes(list, id, time, (notes) => notes.filter((n) => n.id !== noteId));

/** Whether `note` applies to `operation`: unscoped, or scoped to that same operation. */
const appliesTo = (note: SectionNote, operation: string) => note.operation === null || norm(note.operation) === norm(operation);

/** The agent(s) taking part in an operation: one id or label, several, or '' for none. */
export type Agents = string | readonly string[];
const agentList = (agent: Agents): string[] => (typeof agent === 'string' ? [agent] : [...agent]).map(norm).filter(Boolean);

/** Whether `section` is cross-referenced for `operation` run by `agent`. */
function matches(section: KnowledgeSection, operation: string, agent: Agents): boolean {
  const name = norm(section.name);
  if (section.scope === 'agent') return agentList(agent).includes(name);
  const op = norm(operation);
  return (!!op && op.includes(name)) || (!!op && section.notes.some((n) => n.operation !== null && norm(n.operation) === op));
}

/** The sections cross-referenced for `operation` run by `agent` ('' for none). */
export const matchSections = (list: KnowledgeSection[], operation: string, agent: Agents = ''): KnowledgeSection[] =>
  list.filter((s) => matches(s, operation, agent));

const TAG_LINE: Record<NoteTag, (section: string, text: string) => string> = {
  important: (s, t) => `[Section ${s} · important] ${t}`,
  blacklist: (s, t) => `[Section ${s} · blacklisted method] do NOT use: ${t}`,
  recent: (s, t) => `[Section ${s} · recent] ${t}`,
};

/** One section's injected notes for `operation`: every important and blacklisted note, then the newest recent ones. */
function sectionNoteLines(section: KnowledgeSection, operation: string): string[] {
  const notes = section.notes.filter((n) => appliesTo(n, operation));
  const pick = (tag: NoteTag) => notes.filter((n) => n.tag === tag);
  return [...pick('important'), ...pick('blacklist'), ...pick('recent').slice(0, RECENT_INJECTED)].map((n) => TAG_LINE[n.tag](section.name, n.text));
}

/** The context lines every matched section injects into `operation` run by `agent`. */
export const sectionLines = (list: KnowledgeSection[], operation: string, agent: Agents = ''): string[] =>
  matchSections(list, operation, agent).flatMap((s) => sectionNoteLines(s, operation));

const isStr = (v: unknown): v is string => typeof v === 'string';

function isSectionNote(v: unknown): v is SectionNote {
  if (!v || typeof v !== 'object') return false;
  const n = v as Record<string, unknown>;
  return isStr(n.id) && isStr(n.text) && NOTE_TAGS.includes(n.tag as NoteTag) && (n.operation === null || isStr(n.operation)) && typeof n.time === 'number';
}

/** True for a stored section; its invalid notes make it invalid too. */
export function isKnowledgeSection(v: unknown): v is KnowledgeSection {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return isStr(s.id) && isStr(s.name) && SECTION_SCOPES.includes(s.scope as SectionScope) && Array.isArray(s.notes) && s.notes.every(isSectionNote)
    && typeof s.created === 'number' && typeof s.updated === 'number';
}
