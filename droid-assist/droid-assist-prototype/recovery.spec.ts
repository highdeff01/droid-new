import { beforeEach, describe, expect, it } from 'vitest';
import { exportBackup } from './backup.js';
import {
  LAST_GOOD_KEY,
  RECOVERY_FORMAT,
  loadLastGood,
  recoverStorage,
  recoveryFile,
  recoveryFileName,
  recoveryText,
  restoreLastGood,
  saveLastGood,
  snapshotLastGood,
} from './recovery.js';
import type { Habit } from './types.js';

const NOW = Date.UTC(2026, 9, 27);
const habits: Habit[] = [{ id: 'h1', target: 'x', context: '', attempts: 1, successes: 1, lastUsed: 1, lessons: [], pinned: false }];

describe('recoverStorage', () => {
  beforeEach(() => localStorage.clear());

  it('reports no corrupt stores and changes nothing on clean storage', () => {
    localStorage.setItem('droid-assist.settings', '{}');
    localStorage.setItem('droid-assist.habits', JSON.stringify(habits));
    const before = localStorage.getItem('droid-assist.habits');
    const report = recoverStorage(localStorage, NOW);
    expect(report.corrupt).toEqual([]);
    expect(report.lastGoodAt).toBeNull();
    expect(report.prunedFrames).toBe(0);
    expect(localStorage.getItem('droid-assist.habits')).toBe(before);
  });

  it('restores invalid JSON from the last good export, preserving the raw text', () => {
    localStorage.setItem('droid-assist.habits', JSON.stringify(habits));
    const snapshotTime = NOW - 1000;
    snapshotLastGood(localStorage, snapshotTime);
    localStorage.setItem('droid-assist.habits', '{oops');
    const report = recoverStorage(localStorage, NOW);
    expect(report.corrupt).toEqual([{ key: 'droid-assist.habits', label: 'Habits', raw: '{oops', reason: 'not valid JSON', fix: 'restored' }]);
    expect(JSON.parse(localStorage.getItem('droid-assist.habits')!)).toEqual(habits);
    expect(report.lastGoodAt).toBe(new Date(snapshotTime).toISOString());
  });

  it('removes a corrupt store with no snapshot to restore from', () => {
    localStorage.setItem('droid-assist.habits', '{oops');
    const report = recoverStorage(localStorage, NOW);
    expect(report.corrupt).toEqual([{ key: 'droid-assist.habits', label: 'Habits', raw: '{oops', reason: 'not valid JSON', fix: 'reset' }]);
    expect(localStorage.getItem('droid-assist.habits')).toBeNull();
    expect(report.lastGoodAt).toBeNull();
  });

  it('treats a wrong-shaped settings or habits store as corrupt', () => {
    localStorage.setItem('droid-assist.settings', '[]');
    localStorage.setItem('droid-assist.habits', '{}');
    const report = recoverStorage(localStorage, NOW);
    expect(report.corrupt.find((c) => c.key === 'droid-assist.settings')?.reason).toBe('expected an object');
    expect(report.corrupt.find((c) => c.key === 'droid-assist.habits')?.reason).toBe('expected a list');
  });

  it('resets corrupt extra stores (runs, triggers, notifications)', () => {
    localStorage.setItem('droid-assist.runs', '{bad');
    localStorage.setItem('droid-assist.triggers', '{bad');
    localStorage.setItem('droid-assist.notifications', '{bad');
    const report = recoverStorage(localStorage, NOW);
    expect(report.corrupt.map((c) => c.key).sort()).toEqual(['droid-assist.notifications', 'droid-assist.runs', 'droid-assist.triggers']);
    expect(report.corrupt.every((c) => c.fix === 'reset')).toBe(true);
    expect(localStorage.getItem('droid-assist.runs')).toBeNull();
  });
});

describe('loadLastGood', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when no snapshot is stored', () => {
    expect(loadLastGood(localStorage)).toBeNull();
  });

  it('returns null when the snapshot cannot be parsed', () => {
    localStorage.setItem(LAST_GOOD_KEY, '{not json');
    expect(loadLastGood(localStorage)).toBeNull();
  });
});

describe('saveLastGood', () => {
  beforeEach(() => localStorage.clear());

  it('returns false when the storage write throws', () => {
    const fake = { setItem: () => { throw new Error('full'); } };
    expect(saveLastGood(exportBackup(localStorage, NOW), fake)).toBe(false);
  });
});

describe('restoreLastGood', () => {
  beforeEach(() => localStorage.clear());

  it('returns null and changes nothing when there is no snapshot', () => {
    localStorage.setItem('droid-assist.habits', JSON.stringify(habits));
    expect(restoreLastGood(localStorage)).toBeNull();
    expect(JSON.parse(localStorage.getItem('droid-assist.habits')!)).toEqual(habits);
  });

  it('writes every snapshot store back and returns the snapshot', () => {
    localStorage.setItem('droid-assist.habits', JSON.stringify(habits));
    snapshotLastGood(localStorage, NOW);
    localStorage.setItem('droid-assist.habits', JSON.stringify([]));
    const result = restoreLastGood(localStorage);
    expect(result?.stores.habits).toEqual(habits);
    expect(JSON.parse(localStorage.getItem('droid-assist.habits')!)).toEqual(habits);
  });
});

describe('recoveryText', () => {
  beforeEach(() => localStorage.clear());

  it('builds a recovery file with the corrupt stores verbatim', () => {
    localStorage.setItem('droid-assist.habits', '{oops');
    const report = recoverStorage(localStorage, NOW);
    const file = recoveryFile(report);
    expect(file.format).toBe(RECOVERY_FORMAT);
    expect(file.createdAt).toBe(new Date(NOW).toISOString());
    expect(file.stores).toEqual([{ key: 'droid-assist.habits', label: 'Habits', raw: '{oops', reason: 'not valid JSON' }]);
  });

  it('names the recovery file with a timestamp', () => {
    expect(recoveryFileName(NOW)).toMatch(/^droid-assist-recovery-.*\.json$/);
  });

  it('reports a clean scan', () => {
    const report = recoverStorage(localStorage, NOW);
    expect(recoveryText(report)).toBe('All stores read cleanly');
  });

  it('mentions a restored store by label and reason', () => {
    localStorage.setItem('droid-assist.habits', JSON.stringify(habits));
    snapshotLastGood(localStorage, NOW);
    localStorage.setItem('droid-assist.habits', '{oops');
    const report = recoverStorage(localStorage, NOW);
    const text = recoveryText(report);
    expect(text).toContain('Habits');
    expect(text).toContain('restored from the last good export');
  });

  it('mentions a reset store when there was no snapshot', () => {
    localStorage.setItem('droid-assist.habits', '{oops');
    const report = recoverStorage(localStorage, NOW);
    expect(recoveryText(report)).toContain('reset to defaults');
  });

  it('mentions pruned frames when there are any', () => {
    const clean = recoverStorage(localStorage, NOW);
    expect(recoveryText({ ...clean, prunedFrames: 2 })).toContain('2 corrupt screenshot record(s) removed');
  });
});
