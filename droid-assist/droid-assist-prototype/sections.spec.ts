import { describe, expect, it } from 'vitest';
import type { FamiliarElement } from './types.js';
import type { MappedElement } from './element-map-studio.js';
import { addSection, buildProfiles, changeInScope, createSection, inScope, inSection, parseSectionProposals, recordEvent, scopeLines, scopedMapped, sectionMemoryLines, type ScreenSection } from './sections.js';

const section = (name: string, x: number, y: number, w: number, h: number): ScreenSection => createSection(name, { x, y, w, h }, 'drawn')!;
const sidebar = section('Sidebar', 0, 0, 0.2, 1);
const toolbar = section('Toolbar', 0.2, 0, 0.8, 0.1);
const content = section('Main content', 0.2, 0.1, 0.8, 0.9);
const all = [sidebar, toolbar, content];
const mapped: MappedElement[] = [
  { id: 'm1', name: 'Files', box: { x: 0.05, y: 0.3, w: 0.1, h: 0.06 }, mappedAt: 1 },
  { id: 'm2', name: 'Save button', box: { x: 0.5, y: 0.02, w: 0.06, h: 0.04 }, mappedAt: 1 },
];
const familiar: FamiliarElement[] = [{ id: 'f1', name: 'Editor', x: 0.6, y: 0.5, lastSeen: 1 }, { id: 'f2', name: 'files', x: 0.1, y: 0.32, lastSeen: 1 }];

describe('sections', () => {
  it('contains an element by its centre, edges inclusive', () => {
    expect(inSection(sidebar, { x: 0.2, y: 1 })).toBe(true);
    expect(inSection(sidebar, { x: 0.21, y: 0.5 })).toBe(false);
    expect(inSection(sidebar, { x: 0.15, y: 0.5, w: 0.1, h: 0.1 })).toBe(true);
  });

  it('builds a profile per section with scoped dossiers, logs and change history', () => {
    const withEvents = recordEvent(recordEvent(all, { time: 1, kind: 'change', text: 'badge appeared', box: { x: 0.01, y: 0.5, w: 0.05, h: 0.05 } }), { time: 2, kind: 'log', text: 'run started' });
    const profiles = buildProfiles(withEvents, mapped, familiar, { srcW: 1000, srcH: 500 });
    const side = profiles.find((p) => p.section.name === 'Sidebar')!;
    expect(side.elements.map((e) => e.name)).toEqual(['Files']);
    expect(side.elements[0].dossier).toContain('in "Sidebar" at 50.0% across');
    expect(side.elements[0].dossier).toContain('(100, 165)px');
    expect(side.changes.map((c) => c.text)).toEqual(['badge appeared']);
    expect(side.log.map((c) => c.text)).toEqual(['run started']);
    const main = profiles.find((p) => p.section.name === 'Main content')!;
    expect(main.elements.map((e) => e.name)).toEqual(['Editor']);
    expect(main.changes).toEqual([]);
    expect(profiles.find((p) => p.section.name === 'Toolbar')!.elements.map((e) => e.name)).toEqual(['Save button']);
  });

  it('replaces a same-named section keeping its history', () => {
    const first = recordEvent([sidebar], { time: 1, kind: 'log', text: 'x' });
    const list = addSection(first, section('sidebar', 0, 0, 0.25, 1));
    expect(list).toHaveLength(1);
    expect(list[0].box.w).toBe(0.25);
    expect(list[0].events.map((e) => e.text)).toEqual(['x']);
  });
});

describe('goal seclusion', () => {
  it('treats an empty scope or unknown names as the whole screen', () => {
    expect(inScope(all, [], { x: 0.9, y: 0.9 })).toBe(true);
    expect(inScope(all, ['Nowhere'], { x: 0.9, y: 0.9 })).toBe(true);
    expect(scopeLines(all, ['Nowhere'])).toEqual([]);
  });

  it('ignores points, elements and changes outside the scoped sections', () => {
    expect(inScope(all, ['sidebar', 'Nowhere'], { x: 0.1, y: 0.5 })).toBe(true);
    expect(inScope(all, ['Sidebar'], { x: 0.6, y: 0.5 })).toBe(false);
    expect(scopedMapped(all, ['Toolbar'], mapped).map((m) => m.name)).toEqual(['Save button']);
    expect(changeInScope(all, ['Toolbar'], { x: 0.5, y: 0.5, w: 0.1, h: 0.1 })).toBe(false);
    expect(changeInScope(all, ['Toolbar'], { x: 0.5, y: 0.05, w: 0.1, h: 0.3 })).toBe(true);
    const [line] = scopeLines(all, ['Toolbar', 'Sidebar']);
    expect(line).toMatch(/^\[Goal scope\]/);
    expect(line).toContain('"Sidebar" x=0.0%..20.0%');
    expect(line).toContain('"Toolbar"');
    expect(line).not.toContain('Main content');
  });
});

describe('AI-proposed sections', () => {
  it('parses valid proposals, clamps boxes and drops invalid entries', () => {
    const reply = { content: '{"sections":[{"name":"Preview area","x":0.6,"y":0.2,"w":0.6,"h":0.5},{"name":"","x":0,"y":0,"w":0.1,"h":0.1},{"name":"Bad","x":"a","y":0,"w":0.1,"h":0.1},{"name":"Zero","x":0,"y":0,"w":0,"h":0.1}]}', thinking: null };
    const out = parseSectionProposals(reply);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'Preview area', source: 'ai' });
    expect(out[0].box.w).toBeCloseTo(0.4);
  });
});

describe('cross-section memory', () => {
  it('summarises each section and cross-references a pattern seen in several', () => {
    const list = recordEvent(recordEvent(all, { time: 1, kind: 'change', text: 'Tooltip flickers', box: { x: 0.1, y: 0.05, w: 0.3, h: 0.02 } }), { time: 2, kind: 'change', text: 'tooltip flickers', box: { x: 0.5, y: 0.5, w: 0.01, h: 0.01 } });
    const lines = sectionMemoryLines(buildProfiles(list, mapped, familiar));
    expect(lines.filter((l) => l.startsWith('[Section] '))).toHaveLength(3);
    const shared = lines.find((l) => l.startsWith('[Section pattern]'))!;
    expect(shared).toContain('"Sidebar"');
    expect(shared).toContain('"Toolbar"');
    expect(shared).toContain('"Main content"');
  });
});
