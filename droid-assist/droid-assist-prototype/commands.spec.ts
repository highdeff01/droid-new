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
});
