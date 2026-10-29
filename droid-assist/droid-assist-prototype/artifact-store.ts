import type { Presentation } from './presentation.js';
import type { SavedScript } from './script-op.js';
import type { KnowledgeEntry } from './video-notes.js';
import type { Slideshow } from './slideshow.js';
import type { Movie } from './movie.js';
import type { PresentationProject } from './presentation-project.js';

/** Most entries kept in each artifact store. */
export const ARTIFACT_LIMIT = 50;

const KEYS = {
  presentations: 'droid-assist.presentations',
  scripts: 'droid-assist.scripts',
  knowledge: 'droid-assist.knowledge',
  slideshows: 'droid-assist.slideshows',
  movies: 'droid-assist.movies',
  projects: 'droid-assist.projects',
} as const;

/** Every artifact store and the shape of its entries. */
export interface Artifacts {
  presentations: Presentation[];
  scripts: SavedScript[];
  knowledge: KnowledgeEntry[];
  slideshows: Slideshow[];
  movies: Movie[];
  projects: PresentationProject[];
}

/** The name of one artifact store. */
export type ArtifactKind = keyof Artifacts;

const hasId = (v: unknown): v is { id: string } => !!v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string';

/** A knowledge entry with a notes array; entries persisted by an earlier shape without one get `notes: []`. */
const withNotes = (e: { id: string; notes?: unknown }) => (Array.isArray(e.notes) ? e : { ...e, notes: [] });

/** Per-kind repair of stored entries whose shape predates the current store. */
const NORMALIZE: Partial<Record<ArtifactKind, (e: { id: string }) => { id: string }>> = { knowledge: withNotes };

/** The stored list of `kind` (entries without an id dropped, older shapes repaired); empty when missing or corrupt. */
export function loadArtifacts<K extends ArtifactKind>(kind: K): Artifacts[K] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEYS[kind]) ?? '[]');
    const kept = Array.isArray(raw) ? raw.filter(hasId) : [];
    const normalize = NORMALIZE[kind];
    return (normalize ? kept.map(normalize) : kept) as Artifacts[K];
  } catch {
    return [] as Artifacts[K];
  }
}

/** Persists the newest ARTIFACT_LIMIT entries of `kind`; false when storage is unavailable or full. */
export function saveArtifacts<K extends ArtifactKind>(kind: K, list: Artifacts[K]): boolean {
  try {
    localStorage.setItem(KEYS[kind], JSON.stringify(list.slice(0, ARTIFACT_LIMIT)));
    return true;
  } catch {
    return false;
  }
}

/** `item` added newest first, replacing an entry with the same id. */
export const upsertArtifact = <T extends { id: string }>(list: T[], item: T): T[] => [item, ...list.filter((x) => x.id !== item.id)].slice(0, ARTIFACT_LIMIT);
