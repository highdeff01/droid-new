import { describe, expect, it } from 'vitest';
import { ALL_PROJECTS, KNOWLEDGE_KEY, addUserNote, loadKnowledge, markInjected, noteLine, pendingNotesFor, saveKnowledge } from './knowledge-store.js';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

describe('knowledge store', () => {
  it('adds trimmed notes newest first and ignores blank text', () => {
    let notes = addUserNote([], '  Use the dark theme ', 'Fix layout', 1);
    notes = addUserNote(notes, 'Ask before deleting', '', 2);
    expect(addUserNote(notes, '   ', 'x')).toBe(notes);
    expect(notes.map((n) => [n.text, n.project])).toEqual([['Ask before deleting', ALL_PROJECTS], ['Use the dark theme', 'Fix layout']]);
  });

  it('injects a note once per targeted project and an all-projects note into each project', () => {
    let notes = addUserNote([], 'For A', 'A', 1);
    notes = addUserNote(notes, 'For all', ALL_PROJECTS, 2);
    notes = addUserNote(notes, 'For B', 'B', 3);
    const forA = pendingNotesFor(notes, 'A');
    expect(forA.map((n) => n.text)).toEqual(['For A', 'For all']);
    notes = markInjected(notes, forA.map((n) => n.id), 'A');
    expect(pendingNotesFor(notes, 'A')).toEqual([]);
    expect(pendingNotesFor(notes, 'B').map((n) => n.text)).toEqual(['For all', 'For B']);
    expect(notes).toHaveLength(3);
    expect(noteLine(forA[0])).toBe('User note: For A');
  });

  it('persists notes with their injection marks and drops invalid stored entries', () => {
    const store = memory();
    const notes = markInjected(addUserNote([], 'Keep', ALL_PROJECTS, 1), [], 'A');
    saveKnowledge(markInjected(notes, [notes[0].id], 'A'), store);
    expect(loadKnowledge(store)[0]).toMatchObject({ text: 'Keep', injectedInto: ['A'] });
    store.data.set(KNOWLEDGE_KEY, JSON.stringify([{ id: 'x', time: 1, text: 'no list', project: '*' }]));
    expect(loadKnowledge(store)).toEqual([]);
  });
});
