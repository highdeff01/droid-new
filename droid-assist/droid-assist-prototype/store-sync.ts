/**
 * Two-way sync of the learned knowledge stores over the assist bridge. An element learned reliably in
 * one app becomes known to the other, and a blacklist entry is respected by both. The wire form is
 * delta-based: each side sends the store entries it has observed since the last exchange, and each
 * side merges what it receives into the stores it already has. There are no parallel stores — the
 * merge lands straight in storage.ts.
 *
 * Conflicts are resolved per key by the most recent verified observation; when two observations carry
 * the same timestamp the union keeps both (nothing is dropped).
 */
import type { StoreDelta, StoreDeltaPayload } from './main-bridge-protocol.js';

/** The learned stores that sync both ways, named as on the wire. */
export const SYNC_STORES = ['habits', 'familiar', 'elementMap', 'accessPaths', 'avoidRules', 'patterns'] as const;
export type SyncStore = (typeof SYNC_STORES)[number];

/** The last time each store was observed here, per entry key; the base of the next delta. */
export type StoreWatermarks = Partial<Record<SyncStore, Record<string, number>>>;

/** One entry as it travels: its store, its identity within the store, and when it was last verified. */
export interface SyncEntry {
  store: SyncStore;
  key: string;
  /** Last verified observation, ms since epoch. */
  at: number;
  value: Record<string, unknown>;
}

/** What a merge changed, for the log line and the store writes. */
export interface MergeResult {
  /** Entries this side did not have, or had older. */
  added: SyncEntry[];
  /** Entries this side already had at the same or a newer time (kept). */
  kept: number;
  /** Entries dropped because the delta repeated a key already taken from it. */
  duplicates: number;
}

/**
 * The delta this side should send: every entry observed after the watermark for its store. Entries with
 * no watermark (never synced) are all sent.
 */
export function outgoingDelta(entries: readonly SyncEntry[], watermarks: StoreWatermarks): SyncEntry[] {
  return entries.filter((e) => {
    const mark = watermarks[e.store]?.[e.key];
    return mark === undefined || e.at > mark;
  });
}

/**
 * Merges a peer's delta over the entries this side holds. A key seen before keeps the most recent
 * observation; equal timestamps keep the local one and count the peer's as kept, so nothing is dropped.
 * A key repeated inside the delta itself is sent to `added` once.
 */
export function mergeDelta(local: readonly SyncEntry[], incoming: readonly SyncEntry[]): MergeResult {
  const id = (e: SyncEntry) => `${e.store}\u0000${e.key}`;
  const byStoreKey = new Map(local.map((e) => [id(e), e]));
  const added = new Map<string, SyncEntry>();
  let kept = 0;
  let duplicates = 0;
  for (const entry of incoming) {
    const key = id(entry);
    const current = byStoreKey.get(key);
    if (current && current.at >= entry.at) {
      kept += 1;
      continue;
    }
    const pending = added.get(key);
    if (pending) {
      duplicates += 1;
      if (entry.at > pending.at) added.set(key, entry);
      continue;
    }
    added.set(key, entry);
  }
  return { added: [...added.values()], kept, duplicates };
}

/** Watermarks advanced by `entries`: each store remembers the newest time it has seen per key. */
export function advanceWatermarks(watermarks: StoreWatermarks, entries: readonly SyncEntry[]): StoreWatermarks {
  const next: StoreWatermarks = { ...watermarks };
  for (const e of entries) {
    const store = { ...(next[e.store] ?? {}) };
    store[e.key] = Math.max(store[e.key] ?? 0, e.at);
    next[e.store] = store;
  }
  return next;
}

/** The wire payload of a delta. */
export const toPayload = (entries: readonly SyncEntry[]): StoreDeltaPayload => ({
  entries: entries.map((e): StoreDelta => ({ store: e.store, key: e.key, at: e.at, value: e.value })),
});

/** The entries of a validated wire delta. */
export const fromPayload = (payload: StoreDeltaPayload): SyncEntry[] =>
  payload.entries.map((e) => ({ store: e.store as SyncStore, key: e.key, at: e.at, value: e.value }));

/** A one-line summary of a merge, for the log. */
export const mergeLine = (from: string, result: MergeResult): string =>
  `Store sync from ${from}: learned ${result.added.length} (${[...new Set(result.added.map((e) => e.store))].join(', ') || 'none'}), kept ${result.kept} newer local${result.duplicates ? `, ${result.duplicates} repeated in the delta` : ''}`;
