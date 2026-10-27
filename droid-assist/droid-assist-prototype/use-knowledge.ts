import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addPortfolioEntry, aiActor, type PortfolioEntry, type PortfolioKind, type PortfolioSource } from './portfolio.js';
import { profileLines, profileSuggestions, recordSignal, summarizeProfile, type ProfileEvent, type ProfileSignal } from './user-profile.js';
import { addSectionNote, createSection, deleteSection, matchSections, removeSectionNote, renameSection, sectionLines, type KnowledgeSection, type NoteTag, type SectionScope } from './knowledge-sections.js';
import { loadPortfolios, loadProfile, loadSections, savePortfolios, saveProfile, saveSections } from './storage.js';

/** What the knowledge hook reads from the assist engine at the moment of a record. */
export interface KnowledgeDeps {
  /** The operation running now: its goal text and plan id. */
  source: () => PortfolioSource;
  /** The configured (main) AI model. */
  model: () => string;
}

/**
 * Portfolios, the user-habit profile and the sectioned knowledge store, persisted; plus the
 * cross-reference of sections and profile into an operation's context.
 */
export function useKnowledge(deps: KnowledgeDeps) {
  const [portfolios, setPortfolios] = useState<PortfolioEntry[]>(loadPortfolios);
  const [profile, setProfile] = useState<ProfileEvent[]>(loadProfile);
  const [sections, setSections] = useState<KnowledgeSection[]>(loadSections);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  useEffect(() => savePortfolios(portfolios), [portfolios]);
  useEffect(() => saveProfile(profile), [profile]);
  useEffect(() => saveSections(sections), [sections]);

  const profileSummary = useMemo(() => summarizeProfile(profile), [profile]);
  const summaryRef = useRef(profileSummary);
  summaryRef.current = profileSummary;

  /** Adds an entry to `actor`'s portfolio, attributed to the operation running now. */
  const recordFor = useCallback((actor: string, kind: PortfolioKind, text: string, ok?: boolean) => {
    const source = depsRef.current.source();
    setPortfolios((list) => addPortfolioEntry(list, { actor, kind, text, source, ...(ok === undefined ? {} : { ok }) }));
  }, []);

  /** Adds an entry to the portfolio of the AI model answering now. */
  const recordAi = useCallback((kind: PortfolioKind, text: string, ok?: boolean) => recordFor(aiActor(depsRef.current.model()), kind, text, ok), [recordFor]);

  /** Records an approved command, a saved operation or a correction in the user profile. */
  const noteSignal = useCallback((signal: ProfileSignal, text: string) => {
    const { operation } = depsRef.current.source();
    setProfile((events) => recordSignal(events, signal, text, operation));
  }, []);

  /** The lines cross-referenced into `operation` run by `agent`: matched sections, then the user profile. */
  const contextFor = useCallback((operation: string, agent = ''): string[] => [...sectionLines(sectionsRef.current, operation, agent), ...profileLines(summaryRef.current)], []);

  /** The names of the sections cross-referenced for `operation` run by `agent`. */
  const matchedSections = useCallback((operation: string, agent = '') => matchSections(sectionsRef.current, operation, agent).map((s) => s.name), []);

  return {
    portfolios, profile, profileSummary, sections,
    suggestions: (current: string) => profileSuggestions(profileSummary, current),
    recordFor, recordAi, noteSignal, contextFor, matchedSections,
    createSection: (name: string, scope: SectionScope) => setSections((l) => createSection(l, name, scope)),
    renameSection: (id: string, name: string) => setSections((l) => renameSection(l, id, name)),
    deleteSection: (id: string) => setSections((l) => deleteSection(l, id)),
    addSectionNote: (id: string, note: { text: string; tag: NoteTag; operation?: string | null }) => setSections((l) => addSectionNote(l, id, note)),
    removeSectionNote: (id: string, noteId: string) => setSections((l) => removeSectionNote(l, id, noteId)),
  };
}

export type KnowledgeApi = ReturnType<typeof useKnowledge>;
