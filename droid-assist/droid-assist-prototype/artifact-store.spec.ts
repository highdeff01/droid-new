import { beforeEach, describe, expect, it } from 'vitest';
import { ARTIFACT_LIMIT, loadArtifacts, saveArtifacts, upsertArtifact } from './artifact-store.js';
import type { SavedScript } from './script-op.js';

const script = (id: string): SavedScript => ({ id, name: id, description: '', steps: [], saved: 1 });

beforeEach(() => {
  localStorage.clear();
});

describe('loadArtifacts', () => {
  it('[] when missing', () => {
    expect(loadArtifacts('scripts')).toEqual([]);
  });

  it('[] when corrupt', () => {
    localStorage.setItem('droid-assist.scripts', 'not json');
    expect(loadArtifacts('scripts')).toEqual([]);
  });

  it('drops entries without id', () => {
    localStorage.setItem('droid-assist.scripts', JSON.stringify([{ id: 'a' }, { name: 'no id' }]));
    expect(loadArtifacts('scripts')).toEqual([{ id: 'a' }]);
  });

  it('gives knowledge entries without a notes array notes: []', () => {
    const kept = [{ text: 'x', offsetMs: 0 }];
    localStorage.setItem('droid-assist.knowledge', JSON.stringify([{ id: 'a' }, { id: 'b', notes: null }, { id: 'c', notes: 'bad' }, { id: 'd', notes: kept }]));
    expect(loadArtifacts('knowledge').map((k) => k.notes)).toEqual([[], [], [], kept]);
  });
});

describe('saveArtifacts', () => {
  it("writes key 'droid-assist.scripts'", () => {
    saveArtifacts('scripts', [script('a')]);
    expect(localStorage.getItem('droid-assist.scripts')).toBe(JSON.stringify([script('a')]));
  });

  it('round-trips', () => {
    const list = [script('a'), script('b')];
    saveArtifacts('scripts', list);
    expect(loadArtifacts('scripts')).toEqual(list);
  });

  it('keeps only ARTIFACT_LIMIT entries', () => {
    const list = Array.from({ length: ARTIFACT_LIMIT + 10 }, (_, i) => script(`s${i}`));
    saveArtifacts('scripts', list);
    expect(loadArtifacts('scripts')).toHaveLength(ARTIFACT_LIMIT);
  });
});

describe('upsertArtifact', () => {
  it('newest first', () => {
    const list = upsertArtifact([script('a')], script('b'));
    expect(list.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('replaces same id', () => {
    const list = upsertArtifact([{ ...script('a'), description: 'old' }], { ...script('a'), description: 'new' });
    expect(list).toHaveLength(1);
    expect(list[0].description).toBe('new');
  });
});
