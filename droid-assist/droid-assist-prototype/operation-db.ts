/** IndexedDB database of operations, kept alongside the frame store ('droid-assist') under its own name. */
export const OPERATION_DB = 'droid-assist-operations';
const STORE = 'operations';
const TIME_INDEX = 'time';
/** Newest operations kept; older ones are pruned on write. */
export const OPERATION_LIMIT = 5000;

/** What an operation acted on. */
export const OPERATION_CATEGORIES = ['element', 'track', 'capture', 'error', 'idea'] as const;
export type OperationCategory = (typeof OPERATION_CATEGORIES)[number];

/** One structured operation: who did what, where, with what input and what came out. */
export interface OperationRecord {
  id: string;
  time: number;
  /** The loaded flow's name, else the current goal, else '(no project)'. */
  project: string;
  /** The actor that performed it (log source, agent name). */
  agent: string;
  /** The app area or loop stage it ran in. */
  section: string;
  category: OperationCategory;
  /** Operation type, e.g. 'click', 'map', 'source', 'proposed'. */
  op: string;
  /** The element (target name/label) the operation concerned, when any. */
  element?: string;
  input: string;
  output: string;
  ok: boolean;
  /** Error kind of an 'error' operation (ai, step, drift, bridge, watcher, test). */
  errorKind?: string;
  /** The app of the joint connection that did the work; absent for single-app operations. */
  app?: 'droid-new' | 'droid-main';
}

const isString = (v: unknown) => typeof v === 'string';

/** Whether a stored value is a well-formed operation record. */
export function isOperationRecord(v: unknown): v is OperationRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return isString(r.id) && typeof r.time === 'number' && isString(r.project) && isString(r.agent) && isString(r.section)
    && OPERATION_CATEGORIES.includes(r.category as OperationCategory) && isString(r.op) && isString(r.input) && isString(r.output) && typeof r.ok === 'boolean';
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

/** Resolves an IndexedDB request. */
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Creates the operations store with its time index. */
function upgrade(db: IDBDatabase) {
  db.createObjectStore(STORE, { keyPath: 'id' }).createIndex(TIME_INDEX, TIME_INDEX);
}

/** Opens (once) the operation database; null when IndexedDB is unavailable or fails to open. */
function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = indexedDB.open(OPERATION_DB, 1);
        req.onupgradeneeded = () => upgrade(req.result);
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

/** Runs `work` against the operations store; resolves `fallback` on any storage failure. */
async function withStore<T>(mode: IDBTransactionMode, fallback: T, work: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  try {
    const db = await openDb();
    return db ? await work(db.transaction(STORE, mode).objectStore(STORE)) : fallback;
  } catch {
    return fallback;
  }
}

/** Stores an operation, then deletes the oldest operations beyond `keep`. */
export function putOperation(record: OperationRecord, keep = OPERATION_LIMIT): Promise<void> {
  return withStore('readwrite', undefined, async (store) => {
    await request(store.put(record));
    const oldestFirst = await request(store.index(TIME_INDEX).getAllKeys());
    const excess = oldestFirst.length - Math.max(0, keep);
    await Promise.all(oldestFirst.slice(0, Math.max(0, excess)).map((k) => request(store.delete(k))));
  });
}

/** Every valid stored operation, newest first. Invalid records are skipped. */
export function loadOperations(): Promise<OperationRecord[]> {
  return withStore('readonly', [], async (store) => {
    const all: unknown[] = await request(store.getAll());
    return all.filter(isOperationRecord).sort((a, b) => b.time - a.time);
  });
}

/** Deletes every stored operation. */
export function clearOperations(): Promise<void> {
  return withStore('readwrite', undefined, async (store) => {
    await request(store.clear());
  });
}

/** Test seam: closes and forgets the cached connection so the next call reopens the database. */
export async function resetOperationDb() {
  const db = await dbPromise;
  db?.close();
  dbPromise = null;
}
