import { describe, expect, it } from 'vitest';
import { PORTFOLIO_LIMIT, addEntry, createPersona, personaProgress, upsertPersona } from './persona.js';

describe('createPersona', () => {
  it('creates a persona with an empty portfolio', () => {
    expect(createPersona('p1', 'Zelda', 'A brave hero', 100)).toEqual({
      id: 'p1', name: 'Zelda', character: 'A brave hero', createdAt: 100, entries: [],
    });
  });

  it('trims the name and character', () => {
    expect(createPersona('p1', '  Zelda  ', '  A brave hero  ', 100)).toEqual({
      id: 'p1', name: 'Zelda', character: 'A brave hero', createdAt: 100, entries: [],
    });
  });

  it('returns null for a blank name', () => {
    expect(createPersona('p1', '   ', 'A brave hero')).toBeNull();
  });
});

describe('addEntry', () => {
  const persona = createPersona('p1', 'Zelda', 'A brave hero', 1)!;

  it('prepends the newest entry with kind, text and time', () => {
    const updated = addEntry(persona, 'did', 'Opened the chest', 10);
    expect(updated.entries).toEqual([{ kind: 'did', text: 'Opened the chest', time: 10 }]);
  });

  it('keeps newer entries first as more are added', () => {
    let updated = addEntry(persona, 'did', 'Opened the chest', 10);
    updated = addEntry(updated, 'learned', 'Bombs break walls', 20);
    expect(updated.entries.map((e) => e.text)).toEqual(['Bombs break walls', 'Opened the chest']);
  });

  it('trims the text and ignores a blank one, returning the same object', () => {
    expect(addEntry(persona, 'did', '   ', 10)).toBe(persona);
    expect(addEntry(persona, 'did', '  Opened the chest  ', 10).entries[0].text).toBe('Opened the chest');
  });

  it('caps entries at PORTFOLIO_LIMIT', () => {
    let updated = persona;
    for (let i = 0; i < PORTFOLIO_LIMIT + 5; i++) updated = addEntry(updated, 'did', `step ${i}`, i);
    expect(updated.entries).toHaveLength(PORTFOLIO_LIMIT);
    expect(updated.entries[0].text).toBe(`step ${PORTFOLIO_LIMIT + 4}`);
  });
});

describe('personaProgress', () => {
  const persona = createPersona('p1', 'Zelda', 'A brave hero', 1)!;

  it('counts entries per kind', () => {
    let updated = addEntry(persona, 'did', 'a', 1);
    updated = addEntry(updated, 'learned', 'b', 2);
    updated = addEntry(updated, 'achieved', 'c', 3);
    const progress = personaProgress(updated);
    expect(progress.did).toBe(1);
    expect(progress.learned).toBe(1);
    expect(progress.achieved).toBe(1);
  });

  it('computes level as 1 + achieved + floor(learned / 3)', () => {
    let updated = persona;
    for (let i = 0; i < 2; i++) updated = addEntry(updated, 'achieved', `achieved ${i}`, i);
    for (let i = 0; i < 4; i++) updated = addEntry(updated, 'learned', `learned ${i}`, i);
    expect(personaProgress(updated).level).toBe(4);
  });

  it('reports lastActive as the newest entry time, or null when there are none', () => {
    expect(personaProgress(persona).lastActive).toBeNull();
    const updated = addEntry(addEntry(persona, 'did', 'a', 5), 'did', 'b', 15);
    expect(personaProgress(updated).lastActive).toBe(15);
  });
});

describe('upsertPersona', () => {
  const zelda = createPersona('p1', 'Zelda', 'A brave hero', 1)!;
  const link = createPersona('p2', 'Link', 'A silent hero', 2)!;

  it('replaces an existing persona by id', () => {
    const renamed = { ...zelda, name: 'Princess Zelda' };
    expect(upsertPersona([zelda, link], renamed)).toEqual([renamed, link]);
  });

  it('prepends a new persona', () => {
    const mario = createPersona('p3', 'Mario', 'A plumber', 3)!;
    expect(upsertPersona([zelda, link], mario)).toEqual([mario, zelda, link]);
  });
});
