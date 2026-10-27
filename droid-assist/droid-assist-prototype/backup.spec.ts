import { beforeEach, describe, expect, it } from 'vitest';
import type { Habit, LearnedPattern } from './types.js';
import { BACKUP_FORMAT, BACKUP_STORES, BACKUP_VERSION, BackupError, exportBackup, parseBackup, replaceLosses, restoreBackup, summarizeBackup } from './backup.js';
import { confirmAndRestore } from './backup-panel.js';
import { loadDossiers, loadHabits, loadPatterns, loadSettings, loadWatcher, saveDossiers, saveHabits, savePatterns, saveSettings, saveWatcher } from './storage.js';
import { DEFAULT_SETTINGS } from './use-assist.js';
import type { WatchNote } from './watcher.js';
import type { PositionDossier } from './position-dossier.js';

const NOW = Date.UTC(2026, 9, 27);
const habit = (id: string, lastUsed: number, target = id): Habit => ({ id, target, context: 'ctx', attempts: 4, successes: 4, lastUsed, lessons: [], pinned: true });
const pattern = (id: string, time: number): LearnedPattern => ({ id, kind: 'avoid', pattern: `p ${id}`, context: 'c', time });
const note = (id: string, time: number): WatchNote => ({ id, time, kind: 'element', text: `note ${id}` });
const dossier = (id: string, lastSeen: number): PositionDossier => ({
  id, name: `Element ${id}`, visits: [{ x: 0.1, y: 0.2, since: lastSeen }], spots: [], tests: [],
  timesSeen: 1, lastSeen, moves: { user: 0, ai: 0 },
});

/** Serialises a backup the way the Export button does and reads it back. */
const roundTrip = () => parseBackup(JSON.stringify(exportBackup(localStorage, NOW)));

describe('export', () => {
  beforeEach(() => localStorage.clear());

  it('stamps format, version and export date and bundles every persisted store', () => {
    for (const { key } of Object.values(BACKUP_STORES)) localStorage.setItem(key, key.endsWith('settings') || key.endsWith('watcher') ? '{}' : '[]');
    const backup = exportBackup(localStorage, NOW);
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.exportedAt).toBe('2026-10-27T00:00:00.000Z');
    expect(Object.keys(backup.stores).sort()).toEqual(['cards', 'dossiers', 'elementMap', 'familiar', 'habits', 'history', 'log', 'outbox', 'patterns', 'settings', 'watcher']);
  });

  it('round-trips through a wiped browser: every store loads back unchanged', () => {
    const settings = { ...DEFAULT_SETTINGS, bridgeUrl: 'http://127.0.0.1:9000', captureMs: 750 };
    saveSettings(settings);
    saveHabits([habit('h1', NOW - 1000)], NOW);
    savePatterns([pattern('p1', 5)]);
    saveWatcher({ notes: [note('n1', 3)], proposals: [], tests: [] });
    localStorage.setItem('droid-assist.element-map', JSON.stringify([{ id: 'm1', name: 'OK', box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, mappedAt: 9 }]));
    const before = Object.fromEntries(Object.values(BACKUP_STORES).map(({ key }) => [key, localStorage.getItem(key)]));
    const backup = roundTrip();
    localStorage.clear();
    restoreBackup(backup, 'replace');
    expect(Object.fromEntries(Object.values(BACKUP_STORES).map(({ key }) => [key, localStorage.getItem(key)]))).toEqual(before);
    expect(loadSettings(DEFAULT_SETTINGS)).toEqual(settings);
    expect(loadHabits(NOW)).toEqual([habit('h1', NOW - 1000)]);
    expect(loadPatterns()).toEqual([pattern('p1', 5)]);
    expect(loadWatcher().notes).toEqual([note('n1', 3)]);
  });

  it('omits stores that were never written and summarizes what it holds', () => {
    savePatterns([pattern('a', 1), pattern('b', 2)]);
    saveWatcher({ notes: [note('n', 1)], proposals: [], tests: [] });
    expect(summarizeBackup(roundTrip())).toEqual([
      { store: 'patterns', label: 'Learned patterns', count: 2 },
      { store: 'watcher', label: 'Watcher notes, proposals and tests', count: 1 },
    ]);
  });
});

describe('parseBackup validation', () => {
  const valid = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: '2026-10-27T00:00:00.000Z', stores: {} };
  const fails = (value: unknown, message: RegExp) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    expect(() => parseBackup(text)).toThrow(BackupError);
    expect(() => parseBackup(text)).toThrow(message);
  };

  it('accepts a minimal valid file', () => expect(parseBackup(JSON.stringify(valid)).stores).toEqual({}));
  it('rejects corrupt JSON', () => fails('{"format": "droid-assist-backup", ', /not valid JSON/));
  it('rejects a file that is not a backup', () => fails({ habits: [] }, /not a Droid Assist backup/));
  it('rejects a wrong version', () => fails({ ...valid, version: 2 }, /Unsupported backup version 2/));
  it('rejects a missing export date', () => fails({ ...valid, exportedAt: 'yesterday' }, /export date/));
  it('rejects an unknown store', () => fails({ ...valid, stores: { secrets: [] } }, /unknown store "secrets"/));
  it('rejects a list store that is not a list', () => fails({ ...valid, stores: { habits: {} } }, /Habits must be a list/));
  it('rejects a list entry without an id', () => fails({ ...valid, stores: { familiar: [{ id: 'a' }, { name: 'x' }] } }, /Familiar elements entry 2/));
  it('rejects malformed watcher lists', () => fails({ ...valid, stores: { watcher: { notes: 'x' } } }, /Watcher.*\(notes\) must be a list/));
  it('rejects settings that are not an object', () => fails({ ...valid, stores: { settings: [] } }, /Settings must be an object/));
});

describe('restore', () => {
  beforeEach(() => localStorage.clear());
  const file = (stores: object) => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: '2026-10-27T00:00:00.000Z', stores }));
  const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null');

  it('merge unions lists by id, keeping the newer entry and dropping nothing', () => {
    localStorage.setItem('droid-assist.habits', JSON.stringify([habit('local', 10), habit('shared', 50, 'local-newer')]));
    restoreBackup(file({ habits: [habit('shared', 20, 'file-older'), habit('file', 30)] }), 'merge');
    expect(stored('droid-assist.habits').map((h: Habit) => [h.id, h.target])).toEqual([['shared', 'local-newer'], ['file', 'file'], ['local', 'local']]);
  });

  it('merge takes the file entry when it is newer and unions each watcher list', () => {
    localStorage.setItem('droid-assist.watcher', JSON.stringify({ notes: [note('a', 1)], proposals: [], tests: [] }));
    restoreBackup(file({ watcher: { notes: [{ ...note('a', 9), text: 'newer' }, note('b', 2)], proposals: [], tests: [] } }), 'merge');
    expect(stored('droid-assist.watcher').notes.map((n: WatchNote) => n.text)).toEqual(['newer', 'note b']);
  });

  it('merge keeps local settings; replace takes the file settings', () => {
    localStorage.setItem('droid-assist.settings', JSON.stringify({ bridgeUrl: 'local' }));
    restoreBackup(file({ settings: { bridgeUrl: 'file' } }), 'merge');
    expect(stored('droid-assist.settings')).toEqual({ bridgeUrl: 'local' });
    restoreBackup(file({ settings: { bridgeUrl: 'file' } }), 'replace');
    expect(stored('droid-assist.settings')).toEqual({ bridgeUrl: 'file' });
  });

  it('leaves stores absent from the file untouched', () => {
    localStorage.setItem('droid-assist.patterns', JSON.stringify([pattern('keep', 1)]));
    restoreBackup(file({ habits: [] }), 'replace');
    expect(stored('droid-assist.patterns')).toEqual([pattern('keep', 1)]);
  });

  it('reports local-only and newer local entries a replace would drop', () => {
    localStorage.setItem('droid-assist.patterns', JSON.stringify([pattern('only-here', 1), pattern('shared', 99)]));
    expect(replaceLosses(file({ patterns: [pattern('shared', 5)] }))).toEqual([{ store: 'patterns', label: 'Learned patterns', localOnly: 1, localNewer: 1 }]);
    expect(replaceLosses(file({ patterns: [pattern('only-here', 1), pattern('shared', 99)] }))).toEqual([]);
  });

  it('asks before a replace drops newer local data and writes nothing when declined', () => {
    localStorage.setItem('droid-assist.patterns', JSON.stringify([pattern('only-here', 1)]));
    const questions: string[] = [];
    const ok = confirmAndRestore(file({ patterns: [] }), 'replace', (q) => (questions.push(q), false));
    expect(ok).toBe(false);
    expect(questions[0]).toMatch(/Learned patterns: 1 only on this device/);
    expect(stored('droid-assist.patterns')).toEqual([pattern('only-here', 1)]);
    expect(confirmAndRestore(file({ patterns: [] }), 'replace', () => true)).toBe(true);
    expect(stored('droid-assist.patterns')).toEqual([]);
  });

  it('merge never asks', () => {
    localStorage.setItem('droid-assist.patterns', JSON.stringify([pattern('only-here', 1)]));
    expect(confirmAndRestore(file({ patterns: [pattern('x', 2)] }), 'merge', () => { throw new Error('asked'); })).toBe(true);
    expect(stored('droid-assist.patterns').map((p: LearnedPattern) => p.id)).toEqual(['x', 'only-here']);
  });

  it('rolls back every write and fails loudly when storage is full', () => {
    const data = new Map<string, string>([['droid-assist.settings', '{"a":1}']]);
    const full = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { if (k === 'droid-assist.habits') throw new Error('QuotaExceeded'); data.set(k, v); },
      removeItem: (k: string) => void data.delete(k),
    };
    expect(() => restoreBackup(file({ settings: { a: 2 }, habits: [] }), 'replace', full)).toThrow(/Restore failed writing Habits/);
    expect([...data]).toEqual([['droid-assist.settings', '{"a":1}']]);
  });
});

describe('dossiers', () => {
  beforeEach(() => localStorage.clear());

  it('includes a stored dossiers list in an exported backup and restores it', () => {
    saveDossiers([dossier('d1', 5)]);
    const backup = roundTrip();
    expect(summarizeBackup(backup)).toContainEqual({ store: 'dossiers', label: 'Position dossiers', count: 1 });
    localStorage.clear();
    restoreBackup(backup, 'replace');
    expect(loadDossiers()).toEqual([dossier('d1', 5)]);
  });
});
