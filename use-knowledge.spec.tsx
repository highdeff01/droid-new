import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useKnowledge } from './use-knowledge.js';
import { KnowledgePanel } from './knowledge-panel.js';
import type { AssistEngine } from './use-assist.js';
import { loadPortfolios, loadProfile, loadSections, savePortfolios, saveSections } from './storage.js';

let op = 'save the doc in notepad';
let model = 'qwen';
const deps = { source: () => ({ operation: op, opId: 'plan_1' }), model: () => model };

beforeEach(() => {
  localStorage.clear();
  op = 'save the doc in notepad';
  model = 'qwen';
});
afterEach(cleanup);

describe('useKnowledge', () => {
  it('attributes AI work to the model answering at record time and agent work to the agent, with its source operation', () => {
    const { result } = renderHook(() => useKnowledge(deps));
    act(() => result.current.recordAi('work', 'planned 2 steps'));
    model = 'llava';
    act(() => result.current.recordAi('result', 'verdict ok', true));
    op = 'open mail';
    act(() => result.current.recordFor('coords', 'method', 'avoid double click'));
    const p = result.current.portfolios;
    expect(p.map((e) => e.actor)).toEqual(['coords', 'ai:llava', 'ai:qwen']);
    expect(p[0]).toMatchObject({ kind: 'method', source: { operation: 'open mail', opId: 'plan_1' } });
    expect(typeof p[0].time).toBe('number');
    expect(p[2].source.operation).toBe('save the doc in notepad');
    expect(loadPortfolios()).toHaveLength(3);
  });

  it('builds the profile from signals and cross-references sections then profile into an operation', () => {
    const { result } = renderHook(() => useKnowledge(deps));
    act(() => result.current.noteSignal('command', '/use notepad'));
    act(() => result.current.createSection('Notepad', 'project'));
    const id = result.current.sections[0].id;
    act(() => result.current.addSectionNote(id, { text: 'File menu save', tag: 'blacklist' }));
    expect(result.current.profileSummary.habits).toEqual([{ text: '/use notepad', count: 1 }]);
    const lines = result.current.contextFor('Save in Notepad', 'Planner');
    expect(lines[0]).toContain('do NOT use: File menu save');
    expect(lines.at(-1)).toContain('[User');
    expect(result.current.matchedSections('Save in Notepad')).toEqual(['Notepad']);
    expect(result.current.contextFor('open calc').some((l) => l.includes('File menu'))).toBe(false);
    expect(loadProfile()).toHaveLength(1);
    act(() => result.current.renameSection(id, 'Editor'));
    expect(loadSections()[0].name).toBe('Editor');
  });
});

describe('knowledge storage', () => {
  it('round-trips under its own keys and drops invalid entries', () => {
    saveSections([{ id: 's', name: 'Mail', scope: 'topic', notes: [], created: 1, updated: 1 }]);
    expect(localStorage.getItem('droid-assist.knowledge-sections')).not.toBeNull();
    savePortfolios([{ id: 'p', actor: 'goal', kind: 'note', text: 't', time: 1, source: { operation: '', opId: null } }]);
    expect(localStorage.getItem('droid-assist.portfolios')).not.toBeNull();
    localStorage.setItem('droid-assist.user-profile', JSON.stringify([{ id: 'e', signal: 'saved', text: 'x', operation: '', time: 1 }, { id: 2 }]));
    expect(loadProfile()).toHaveLength(1);
    expect(loadSections()[0].name).toBe('Mail');
    localStorage.setItem('droid-assist.portfolios', '{bad');
    expect(loadPortfolios()).toEqual([]);
  });
});

function Harness() {
  const knowledge = useKnowledge(deps);
  return <KnowledgePanel engine={{ knowledge } as unknown as AssistEngine} />;
}

describe('KnowledgePanel', () => {
  it('creates, browses and renames a section', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('New section name'), { target: { value: 'Billing' } });
    fireEvent.click(screen.getByText('Create section'));
    fireEvent.click(screen.getByRole('button', { name: /^Billing/ }));
    fireEvent.change(screen.getByLabelText('Section name Billing'), { target: { value: 'Invoices' } });
    fireEvent.click(screen.getByText('Rename'));
    expect(screen.getByRole('button', { name: /^Invoices/ })).toBeTruthy();
    expect(loadSections()[0].name).toBe('Invoices');
  });
});
