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
  it('parses /measure with a multi-point query', () => {
    expect(parseCommand('/measure files icon to game icon to left edge')).toEqual({ kind: 'measure', target: 'files icon to game icon to left edge' });
  });
  it('rejects /measure without a query and shows its usage', () => {
    const r = parseCommand('/measure');
    expect(r).toMatchObject({ kind: 'error' });
    expect(r && 'message' in r ? r.message : '').toMatch(/\/measure <a> to <b>/);
  });
});

describe('/arrange', () => {
  it('parses /arrange with a multi-word goal', () => {
    expect(parseCommand('/arrange move the Files icon below Game')).toEqual({ kind: 'arrange', target: 'move the Files icon below Game' });
  });
  it('rejects /arrange without a target', () => {
    const r = parseCommand('/arrange');
    expect(r).toMatchObject({ kind: 'error' });
    expect(r && 'message' in r ? r.message : '').toMatch(/\/arrange/);
  });
});

describe('/snip', () => {
  it('parses /snip with its region', () => {
    expect(parseCommand('/snip 0.1,0.2,0.3,0.4 640x display 2')).toEqual({ kind: 'snip', target: '0.1,0.2,0.3,0.4 640x display 2' });
  });
  it('rejects /snip without a region and shows its usage', () => {
    const r = parseCommand('/snip');
    expect(r && 'message' in r ? r.message : '').toMatch(/\/snip x,y,w,h/);
  });
});
