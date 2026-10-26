import { describe, expect, it } from 'vitest';
import { parseCommand } from './commands.js';

describe('parseCommand', () => {
  it('treats plain goals as non-commands', () => {
    expect(parseCommand('play the game')).toBeNull();
  });
  it('parses /use with a multi-word target', () => {
    expect(parseCommand('  /use Visual Studio Code ')).toEqual({ kind: 'use', target: 'Visual Studio Code' });
  });
  it('rejects /use without a target', () => {
    expect(parseCommand('/use   ')).toMatchObject({ kind: 'error' });
    expect(parseCommand('/use')).toMatchObject({ kind: 'error' });
  });
  it('rejects unknown and look-alike commands', () => {
    expect(parseCommand('/useful thing')).toMatchObject({ kind: 'error' });
    expect(parseCommand('/USE notepad')).toMatchObject({ kind: 'error' });
  });
  it('parses /move with a multi-word target', () => {
    expect(parseCommand('/move files icon')).toEqual({ kind: 'move', target: 'files icon' });
  });
  it('rejects /move without a target', () => {
    expect(parseCommand('/move')).toMatchObject({ kind: 'error' });
    expect(parseCommand('/move   ')).toMatchObject({ kind: 'error' });
  });
  it('parses /test with its spec', () => {
    expect(parseCommand('/test links Files, Notes')).toEqual({ kind: 'test', target: 'links Files, Notes' });
    expect(parseCommand('/test')).toMatchObject({ kind: 'error' });
  });
  it('names /move in the unknown-command error', () => {
    const r = parseCommand('/hover icon');
    expect(r).toMatchObject({ kind: 'error' });
    expect(r && 'message' in r ? r.message : '').toMatch(/\/move/);
  });
});
