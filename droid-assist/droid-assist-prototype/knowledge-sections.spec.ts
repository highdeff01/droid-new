import { describe, expect, it } from 'vitest';
import { RECENT_INJECTED, addSectionNote, createSection, matchSections, renameSection, sectionLines, type KnowledgeSection } from './knowledge-sections.js';

const make = (names: Array<[string, 'topic' | 'project' | 'agent']>) => names.reduce<KnowledgeSection[]>((l, [n, s]) => createSection(l, n, s, 1), []);
const idOf = (list: KnowledgeSection[], name: string) => list.find((s) => s.name === name)!.id;

describe('section management', () => {
  it('creates, refuses blank or duplicate names, and renames', () => {
    let list = make([['Notepad', 'project']]);
    expect(createSection(list, '  ', 'topic')).toBe(list);
    expect(createSection(list, 'notepad', 'topic')).toBe(list);
    list = createSection(list, 'Mail', 'topic', 2);
    expect(renameSection(list, idOf(list, 'Mail'), 'NOTEPAD')).toBe(list);
    const renamed = renameSection(list, idOf(list, 'Mail'), ' Outlook ', 5);
    expect(renamed.find((s) => s.name === 'Outlook')?.updated).toBe(5);
  });

  it('trims notes, ignores empty ones and stores a blank operation as unscoped', () => {
    let list = make([['Notepad', 'project']]);
    const id = idOf(list, 'Notepad');
    list = addSectionNote(list, id, { text: '   ', tag: 'recent' });
    expect(list[0].notes).toEqual([]);
    list = addSectionNote(list, id, { text: ' use ctrl+s ', tag: 'important', operation: ' ' });
    expect(list[0].notes[0]).toMatchObject({ text: 'use ctrl+s', tag: 'important', operation: null });
  });
});

describe('section injection', () => {
  const seeded = () => {
    let list = make([['Notepad', 'project'], ['Mail', 'topic'], ['coords', 'agent']]);
    const np = idOf(list, 'Notepad');
    list = addSectionNote(list, np, { text: 'save with ctrl+s', tag: 'important' }, 1);
    list = addSectionNote(list, np, { text: 'menu File > Save', tag: 'blacklist' }, 2);
    for (let i = 1; i <= 5; i++) list = addSectionNote(list, np, { text: `recent ${i}`, tag: 'recent' }, 10 + i);
    list = addSectionNote(list, np, { text: 'only when printing', tag: 'important', operation: 'print from notepad' }, 20);
    list = addSectionNote(list, idOf(list, 'Mail'), { text: 'inbox is top-left', tag: 'important' }, 3);
    list = addSectionNote(list, idOf(list, 'coords'), { text: 'trust dwell over grounding', tag: 'important' }, 4);
    return list;
  };

  it('injects important, blacklisted and the newest recent notes of a section the operation names', () => {
    const lines = sectionLines(seeded(), 'Save the file in notepad');
    expect(lines.some((l) => l.includes('save with ctrl+s'))).toBe(true);
    expect(lines.find((l) => l.includes('menu File > Save'))).toContain('do NOT use');
    const recent = lines.filter((l) => l.includes('recent '));
    expect(recent).toHaveLength(RECENT_INJECTED);
    expect(recent.map((l) => l.slice(-8))).toEqual(['recent 5', 'recent 4', 'recent 3']);
    expect(lines.some((l) => l.includes('only when printing'))).toBe(false);
    expect(lines.some((l) => l.includes('inbox'))).toBe(false);
  });

  it('injects an operation-scoped note only into that operation', () => {
    expect(sectionLines(seeded(), 'Print from Notepad').some((l) => l.includes('only when printing'))).toBe(true);
  });

  it('matches a section through a note scoped to the operation even when its name is not mentioned', () => {
    let list = make([['Reports', 'project']]);
    list = addSectionNote(list, list[0].id, { text: 'export as pdf', tag: 'important', operation: 'monthly close' });
    expect(sectionLines(list, 'Monthly close')).toEqual([expect.stringContaining('export as pdf')]);
    expect(sectionLines(list, 'weekly close')).toEqual([]);
  });

  it('cross-references an agent section only for that agent', () => {
    const list = seeded();
    expect(matchSections(list, 'coords calibration').map((s) => s.name)).not.toContain('coords');
    expect(sectionLines(list, 'anything', 'coords')).toEqual([expect.stringContaining('trust dwell over grounding')]);
    expect(sectionLines(list, 'anything', 'supervisor')).toEqual([]);
  });

  it('injects nothing when no section matches', () => {
    expect(sectionLines(seeded(), 'open the calculator')).toEqual([]);
  });
});
