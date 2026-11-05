import { describe, expect, it } from 'vitest';
import { clearLongGenerationCheckpoint, loadLongGenerationCheckpoint, saveLongGenerationCheckpoint } from './long-generation-checkpoint.js';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

describe('long-generation checkpoints', () => {
  it('persists and restores the latest partial output across panel reloads', () => {
    const storage = memoryStorage();
    const checkpoint = { id: 'run-1', prompt: 'Build an app', content: 'FILE: src/main.ts\nexport const ready = true;', mode: 'multi_file_code' as const, rounds: 2, updatedAt: 1234 };
    expect(saveLongGenerationCheckpoint(checkpoint, storage)).toBe(true);
    expect(loadLongGenerationCheckpoint(storage)).toEqual(checkpoint);
  });

  it('replaces older snapshots with the latest completed section', () => {
    const storage = memoryStorage();
    const base = { id: 'run-1', prompt: 'Explain', mode: 'answer' as const, updatedAt: 100 };
    saveLongGenerationCheckpoint({ ...base, content: 'Part one', rounds: 1 }, storage);
    saveLongGenerationCheckpoint({ ...base, content: 'Part one\nPart two', rounds: 2, updatedAt: 200 }, storage);
    expect(loadLongGenerationCheckpoint(storage)?.content).toBe('Part one\nPart two');
    expect(loadLongGenerationCheckpoint(storage)?.rounds).toBe(2);
  });

  it('ignores corrupt and oversized checkpoint data', () => {
    const storage = memoryStorage();
    storage.setItem('droid-assist.long-generation-checkpoint.v1', '{broken');
    expect(loadLongGenerationCheckpoint(storage)).toBeNull();
    storage.setItem('droid-assist.long-generation-checkpoint.v1', JSON.stringify({ id: 'x', prompt: 'p', content: 'x'.repeat(100001), mode: 'answer', rounds: 1, updatedAt: 1 }));
    expect(loadLongGenerationCheckpoint(storage)).toBeNull();
  });

  it('clears a saved checkpoint', () => {
    const storage = memoryStorage();
    saveLongGenerationCheckpoint({ id: 'run-1', prompt: 'p', content: 'partial', mode: 'answer', rounds: 1, updatedAt: 1 }, storage);
    expect(clearLongGenerationCheckpoint(storage)).toBe(true);
    expect(loadLongGenerationCheckpoint(storage)).toBeNull();
  });

  it('reports storage failures without throwing', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('blocked'); } };
    const checkpoint = { id: 'run-1', prompt: 'p', content: 'partial', mode: 'answer' as const, rounds: 1, updatedAt: 1 };
    expect(saveLongGenerationCheckpoint(checkpoint, blocked)).toBe(false);
    expect(loadLongGenerationCheckpoint(blocked)).toBeNull();
    expect(clearLongGenerationCheckpoint(blocked)).toBe(false);
  });
});
