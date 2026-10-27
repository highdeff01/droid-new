import { isStoredFrame, type StoredFrame } from './frame-codec.js';

const DB_NAME = 'droid-assist';
const STORE = 'frames';

let dbPromise: Promise<IDBDatabase | null> | null = null;

/** Resolves an IndexedDB request. */
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Opens (once) the frame database; null when IndexedDB is unavailable or fails to open. */
function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

/** Runs `work` against the frame store; resolves `fallback` on any storage failure. */
async function withStore<T>(mode: IDBTransactionMode, fallback: T, work: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  try {
    const db = await openDb();
    return db ? await work(db.transaction(STORE, mode).objectStore(STORE)) : fallback;
  } catch {
    return fallback;
  }
}

/** The newest `limit` valid stored frames, newest first. Invalid records are skipped. */
export function loadStoredFrames(limit: number): Promise<StoredFrame[]> {
  return withStore('readonly', [], async (store) => {
    const all: unknown[] = await request(store.getAll());
    return all.filter(isStoredFrame).sort((a, b) => b.id - a.id).slice(0, limit);
  });
}

/** Stores a frame, then deletes the oldest frames beyond `keep`. */
export function putStoredFrame(frame: StoredFrame, keep: number): Promise<void> {
  return withStore('readwrite', undefined, async (store) => {
    await request(store.put(frame));
    const keys = (await request(store.getAllKeys())).map(Number).sort((a, b) => b - a);
    await Promise.all(keys.slice(Math.max(0, keep)).map((k) => request(store.delete(k))));
  });
}

/** Deletes every record that is not a valid stored frame (startup recovery); resolves how many were removed. */
export function pruneCorruptFrames(): Promise<number> {
  return withStore('readwrite', 0, async (store) => {
    const all: unknown[] = await request(store.getAll());
    const keys = await request(store.getAllKeys());
    const bad = keys.filter((_k, i) => !isStoredFrame(all[i]));
    await Promise.all(bad.map((k) => request(store.delete(k))));
    return bad.length;
  });
}

/** Test seam: closes and forgets the cached connection so the next call reopens the database. */
export async function resetFrameStore() {
  const db = await dbPromise;
  db?.close();
  dbPromise = null;
}
