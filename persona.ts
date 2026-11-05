/** Persona portfolios: one per character the AI plays, tracking what it did, learned and achieved. */

/** What a portfolio entry records. */
export type PortfolioKind = 'did' | 'learned' | 'achieved';

export const PORTFOLIO_KINDS: readonly PortfolioKind[] = ['did', 'learned', 'achieved'];

/** Most entries kept per persona (newest first). */
export const PORTFOLIO_LIMIT = 200;

/** Most personas kept. */
export const PERSONA_LIMIT = 30;

/** One development record of a persona. */
export interface PortfolioEntry {
  kind: PortfolioKind;
  text: string;
  time: number;
}

/** A character the AI plays (a game character or a role) with its development portfolio. */
export interface Persona {
  id: string;
  name: string;
  /** Who the character is and how it should behave. */
  character: string;
  createdAt: number;
  /** Newest first. */
  entries: PortfolioEntry[];
}

/** Counts per kind plus the development level, for the portfolio view. */
export interface PersonaProgress {
  did: number;
  learned: number;
  achieved: number;
  /** Development level: 1 + one per achievement + one per three lessons. */
  level: number;
  lastActive: number | null;
}

/** A new persona with an empty portfolio; null when the name is blank. */
export function createPersona(id: string, name: string, character: string, now = Date.now()): Persona | null {
  const n = name.trim();
  return n ? { id, name: n, character: character.trim(), createdAt: now, entries: [] } : null;
}

/** The persona with `text` added under `kind` (newest first, capped); a blank text leaves it unchanged. */
export function addEntry(persona: Persona, kind: PortfolioKind, text: string, now = Date.now()): Persona {
  const t = text.trim();
  if (!t) return persona;
  return { ...persona, entries: [{ kind, text: t, time: now }, ...persona.entries].slice(0, PORTFOLIO_LIMIT) };
}

/** Progress of a persona from its portfolio. */
export function personaProgress(persona: Persona): PersonaProgress {
  const count = (k: PortfolioKind) => persona.entries.filter((e) => e.kind === k).length;
  const learned = count('learned');
  const achieved = count('achieved');
  return { did: count('did'), learned, achieved, level: 1 + achieved + Math.floor(learned / 3), lastActive: persona.entries[0]?.time ?? null };
}

/** `list` with `persona` replacing the one of the same id, or prepended when new (capped). */
export function upsertPersona(list: Persona[], persona: Persona): Persona[] {
  return list.some((p) => p.id === persona.id) ? list.map((p) => (p.id === persona.id ? persona : p)) : [persona, ...list].slice(0, PERSONA_LIMIT);
}
