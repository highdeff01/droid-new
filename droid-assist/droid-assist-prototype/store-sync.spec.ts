import { describe, expect, it } from 'vitest';
import { SYNC_STORES, advanceWatermarks, fromPayload, mergeDelta, mergeLine, outgoingDelta, toPayload, type SyncEntry } from './store-sync.js';

const entry = (store: SyncEntry['store'], key: string, at: number, value: Record<string, unknown> = {}): SyncEntry => ({ store, key, at, value });

describe('SYNC_STORES', () => {
  it('covers the learned stores named in the spec', () => {
    expect([...SYNC_STORES]).toEqual(['habits', 'familiar', 'elementMap', 'accessPaths', 'avoidRules', 'patterns']);
  });
});

describe('outgoingDelta', () => {
  it('sends everything when nothing has been exchanged yet', () => {
    const entries = [entry('familiar', 'a', 10), entry('habits', 'b', 20)];
    expect(outgoingDelta(entries, {})).toEqual(entries);
  });

  it('sends only entries observed after their store watermark', () => {
    const entries = [entry('familiar', 'a', 10), entry('familiar', 'b', 30), entry('habits', 'c', 5)];
    const marks = { familiar: { a: 10, b: 20 }, habits: { c: 5 } };
    expect(outgoingDelta(entries, marks)).toEqual([entry('familiar', 'b', 30)]);
  });

  it('keeps an entry unchanged at the watermark (only strictly newer crosses)', () => {
    expect(outgoingDelta([entry('patterns', 'p', 7)], { patterns: { p: 7 } })).toEqual([]);
  });
});

describe('mergeDelta', () => {
  it('adds entries the local side does not have', () => {
    const result = mergeDelta([entry('familiar', 'a', 10)], [entry('familiar', 'b', 5), entry('habits', 'c', 5)]);
    expect(result.added).toEqual([entry('familiar', 'b', 5), entry('habits', 'c', 5)]);
    expect(result.kept).toBe(0);
    expect(result.duplicates).toBe(0);
  });

  it('keeps the local entry when it is newer, counting the peer entry as kept (nothing dropped)', () => {
    const result = mergeDelta([entry('familiar', 'a', 20)], [entry('familiar', 'a', 10)]);
    expect(result.added).toEqual([]);
    expect(result.kept).toBe(1);
  });

  it('takes the peer entry when it is the more recent verified observation', () => {
    const result = mergeDelta([entry('familiar', 'a', 10)], [entry('familiar', 'a', 20, { name: 'Files' })]);
    expect(result.added).toEqual([entry('familiar', 'a', 20, { name: 'Files' })]);
    expect(result.kept).toBe(0);
  });

  it('keeps the local entry on a tie, so a union drops nothing', () => {
    const result = mergeDelta([entry('familiar', 'a', 10, { local: true })], [entry('familiar', 'a', 10, { local: false })]);
    expect(result.added).toEqual([]);
    expect(result.kept).toBe(1);
  });

  it('counts a key repeated inside the delta itself once, keeping the newest', () => {
    const result = mergeDelta([], [entry('familiar', 'a', 5), entry('familiar', 'a', 9, { v: 2 })]);
    expect(result.added).toEqual([entry('familiar', 'a', 9, { v: 2 })]);
    expect(result.duplicates).toBe(1);
  });

  it('treats the same key in different stores as different entries', () => {
    const result = mergeDelta([entry('familiar', 'x', 10)], [entry('habits', 'x', 10)]);
    expect(result.added).toEqual([entry('habits', 'x', 10)]);
    expect(result.kept).toBe(0);
  });
});

describe('advanceWatermarks', () => {
  it('remembers the newest time per store and key', () => {
    const next = advanceWatermarks({ familiar: { a: 10 } }, [entry('familiar', 'a', 30), entry('familiar', 'b', 5), entry('habits', 'h', 1)]);
    expect(next).toEqual({ familiar: { a: 30, b: 5 }, habits: { h: 1 } });
  });

  it('never moves a watermark backwards', () => {
    const next = advanceWatermarks({ familiar: { a: 30 } }, [entry('familiar', 'a', 10)]);
    expect(next.familiar?.a).toBe(30);
  });

  it('does not mutate the input watermarks', () => {
    const before = { familiar: { a: 10 } };
    advanceWatermarks(before, [entry('familiar', 'a', 99)]);
    expect(before.familiar.a).toBe(10);
  });
});

describe('toPayload / fromPayload', () => {
  it('round-trips entries through the wire form', () => {
    const entries = [entry('familiar', 'a', 10, { name: 'Files', x: 0.1 }), entry('avoidRules', 'r', 3, { reason: 'no' })];
    expect(fromPayload(toPayload(entries))).toEqual(entries);
  });
});

describe('mergeLine', () => {
  it('names the source, how many were learned and how many newer local entries were kept', () => {
    const line = mergeLine('droid-main', { added: [entry('familiar', 'a', 5), entry('habits', 'b', 5)], kept: 3, duplicates: 0 });
    expect(line).toContain('droid-main');
    expect(line).toContain('learned 2');
    expect(line).toContain('familiar, habits');
    expect(line).toContain('kept 3');
  });

  it('says none when the delta added nothing', () => {
    expect(mergeLine('droid-main', { added: [], kept: 0, duplicates: 0 })).toContain('learned 0 (none)');
  });
});
