import { beforeEach, describe, expect, it } from 'vitest';
import { applySyncEntries, loadStoreWatermarks, loadSyncEntries, saveFamiliar, saveHabits, saveStoreWatermarks, saveAvoidRules } from './storage.js';
import type { FamiliarElement, Habit } from './types.js';
import type { AvoidRule } from './blacklist.js';
import type { SyncEntry } from './store-sync.js';

const familiar = (id: string, lastSeen: number): FamiliarElement => ({ id, name: `el-${id}`, x: 0.1, y: 0.2, lastSeen });
const habit = (id: string, lastUsed: number): Habit => ({ id, target: `t-${id}`, context: '', attempts: 2, successes: 1, lastUsed, lessons: [], pinned: false });
const rule = (id: string, lastAt: number): AvoidRule => ({ id, action: 'click', target: `t-${id}`, x: 0.1, y: 0.1, source: 'habit', reason: 'no', strikes: 2, firstAt: 1, lastAt, expiresAt: Date.now() + 3_600_000 });
const entry = (store: SyncEntry['store'], key: string, at: number, value: Record<string, unknown>): SyncEntry => ({ store, key, at, value });

describe('loadSyncEntries', () => {
  beforeEach(() => localStorage.clear());

  it('reads the learned stores through their own storage, not a parallel store', () => {
    const now = Date.now();
    saveFamiliar([familiar('f1', now - 100)]);
    saveHabits([habit('h1', now - 200)]);
    const entries = loadSyncEntries();
    expect(entries.find((e) => e.store === 'familiar' && e.key === 'f1')?.at).toBe(now - 100);
    expect(entries.find((e) => e.store === 'habits' && e.key === 'h1')?.at).toBe(now - 200);
  });

  it('is empty when nothing has been learned', () => {
    expect(loadSyncEntries()).toEqual([]);
  });
});

describe('applySyncEntries', () => {
  beforeEach(() => localStorage.clear());

  it('adds an element learned in the other app into this app\u2019s familiar store', () => {
    const applied = applySyncEntries([entry('familiar', 'f2', 50, familiar('f2', 50) as unknown as Record<string, unknown>)]);
    expect(applied).toBe(1);
    expect(loadSyncEntries().some((e) => e.store === 'familiar' && e.key === 'f2')).toBe(true);
  });

  it('keeps a newer local observation over an older peer one, dropping nothing', () => {
    saveFamiliar([familiar('f1', 900)]);
    const applied = applySyncEntries([entry('familiar', 'f1', 100, familiar('f1', 100) as unknown as Record<string, unknown>)]);
    expect(applied).toBe(0);
    const stored = loadSyncEntries().find((e) => e.store === 'familiar' && e.key === 'f1');
    expect(stored?.at).toBe(900);
  });

  it('takes the more recent verified observation from the peer', () => {
    saveFamiliar([familiar('f1', 100)]);
    const applied = applySyncEntries([entry('familiar', 'f1', 900, familiar('f1', 900) as unknown as Record<string, unknown>)]);
    expect(applied).toBe(1);
    expect(loadSyncEntries().find((e) => e.store === 'familiar' && e.key === 'f1')?.at).toBe(900);
  });

  it('syncs a blacklist rule so both apps respect it', () => {
    saveAvoidRules([]);
    const applied = applySyncEntries([entry('avoidRules', 'r1', 10, rule('r1', 10) as unknown as Record<string, unknown>)]);
    expect(applied).toBe(1);
    expect(loadSyncEntries().some((e) => e.store === 'avoidRules' && e.key === 'r1')).toBe(true);
  });

  it('drops an invalid entry rather than writing it into a store', () => {
    const applied = applySyncEntries([entry('familiar', 'bad', 5, { id: 'bad' })]);
    expect(applied).toBe(0);
    expect(loadSyncEntries().some((e) => e.key === 'bad')).toBe(false);
  });
});

describe('store watermarks', () => {
  beforeEach(() => localStorage.clear());

  it('round-trip through storage', () => {
    saveStoreWatermarks({ familiar: { f1: 100 }, habits: { h1: 200 } });
    expect(loadStoreWatermarks()).toEqual({ familiar: { f1: 100 }, habits: { h1: 200 } });
  });

  it('ignores a corrupt watermark payload', () => {
    localStorage.setItem('droid-assist.store-sync', '{"familiar":{"f1":"soon"}}');
    expect(loadStoreWatermarks()).toEqual({});
  });
});
