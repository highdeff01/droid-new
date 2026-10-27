import { HISTORY_KEY } from './action-history.js';

/** Marks a file as a Droid Assist backup. */
export const BACKUP_FORMAT = 'droid-assist-backup';
/** Version of the backup file layout this build writes and reads. */
export const BACKUP_VERSION = 1;

/** How a store is held: a settings object, a list of entries with ids, or the watcher's three lists. */
type StoreShape = 'settings' | 'list' | 'watcher';

/** Every persisted store, by name: its localStorage key, a label and its shape. */
export const BACKUP_STORES = {
  settings: { key: 'droid-assist.settings', label: 'Settings', shape: 'settings' },
  habits: { key: 'droid-assist.habits', label: 'Habits', shape: 'list' },
  familiar: { key: 'droid-assist.familiar', label: 'Familiar elements', shape: 'list' },
  elementMap: { key: 'droid-assist.element-map', label: 'Element map', shape: 'list' },
  accessPaths: { key: 'droid-assist.access-paths', label: 'Access paths', shape: 'list' },
  cards: { key: 'droid-assist.cards', label: 'Saved flow cards', shape: 'list' },
  patterns: { key: 'droid-assist.patterns', label: 'Learned patterns', shape: 'list' },
  log: { key: 'droid-assist.log', label: 'Activity log', shape: 'list' },
  history: { key: HISTORY_KEY, label: 'Action history', shape: 'list' },
  watcher: { key: 'droid-assist.watcher', label: 'Watcher notes, proposals and tests', shape: 'watcher' },
  outbox: { key: 'droid-assist.outbox', label: 'Error outbox', shape: 'list' },
  portfolios: { key: 'droid-assist.portfolios', label: 'Agent and AI portfolios', shape: 'list' },
  profile: { key: 'droid-assist.user-profile', label: 'User-habit profile', shape: 'list' },
  sections: { key: 'droid-assist.knowledge-sections', label: 'Knowledge sections', shape: 'list' },
  variations: { key: 'droid-assist.variations', label: 'Background variations', shape: 'list' },
} as const satisfies Record<string, { key: string; label: string; shape: StoreShape }>;

export type StoreName = keyof typeof BACKUP_STORES;
const STORE_NAMES = Object.keys(BACKUP_STORES) as StoreName[];
const WATCHER_LISTS = ['notes', 'proposals', 'tests'] as const;

type Json = Record<string, unknown>;
type Entry = Json & { id: string };
type WatcherLists = Record<(typeof WATCHER_LISTS)[number], Entry[]>;
type BackupStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A parsed, validated backup file. */
export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  /** ISO 8601 time of export. */
  exportedAt: string;
  /** The stored JSON of each store present when exported. */
  stores: Partial<Record<StoreName, unknown>>;
}

/** A backup file that cannot be read or restored; its message says why. */
export class BackupError extends Error {
  override name = 'BackupError';
}

/** Replace overwrites each store in the file; merge unions lists by id and keeps local settings. */
export type RestoreMode = 'replace' | 'merge';

/** What the file holds for one store. */
export interface StoreSummary {
  store: StoreName;
  label: string;
  /** Entries in a list store (all three lists for the watcher); 1 for settings. */
  count: number;
}

/** Local data a replace would lose for one store. */
export interface StoreLoss {
  store: StoreName;
  label: string;
  /** Local entries whose id is not in the file. */
  localOnly: number;
  /** Local entries newer than the file's entry with the same id. */
  localNewer: number;
}

const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const isEntry = (v: unknown): v is Entry => isObject(v) && typeof v.id === 'string' && !!v.id;

/** The time an entry was last changed, from whichever timestamp field its kind carries; 0 when none. */
function stampOf(e: Json): number {
  for (const field of ['lastUsed', 'lastSeen', 'mappedAt', 'savedAt', 'time']) {
    const v = e[field];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  const iso = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : NaN;
  return Number.isNaN(iso) ? 0 : iso;
}

/** Parsed JSON at `key`, or undefined when missing or corrupt. */
function readStored(storage: Pick<Storage, 'getItem'>, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Every store currently persisted, bundled with the format, version and export time. */
export function exportBackup(storage: Pick<Storage, 'getItem'> = localStorage, now = Date.now()): Backup {
  const stores: Backup['stores'] = {};
  for (const name of STORE_NAMES) {
    const value = readStored(storage, BACKUP_STORES[name].key);
    if (value !== undefined) stores[name] = value;
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date(now).toISOString(), stores };
}

/** The download file name for a backup exported at `now`. */
export const backupFileName = (now = Date.now()) => `droid-assist-backup-${new Date(now).toISOString().replace(/[:.]/g, '-')}.json`;

/** Throws unless `value` is a list whose every entry is an object with a string id. */
function checkList(value: unknown, where: string) {
  if (!Array.isArray(value)) throw new BackupError(`${where} must be a list.`);
  const bad = value.findIndex((e) => !isEntry(e));
  if (bad >= 0) throw new BackupError(`${where} entry ${bad + 1} is not a valid entry (missing id).`);
}

/** Throws unless the store's value has the shape its kind requires. */
function checkStore(name: StoreName, value: unknown) {
  const { label, shape } = BACKUP_STORES[name];
  if (shape === 'list') return checkList(value, label);
  if (!isObject(value)) throw new BackupError(`${label} must be an object.`);
  if (shape === 'watcher') for (const list of WATCHER_LISTS) checkList(value[list] ?? [], `${label} (${list})`);
}

/** The backup in `text`, validated; throws BackupError naming what is wrong. */
export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('The file is not valid JSON — it may be corrupt or truncated.');
  }
  if (!isObject(data) || data.format !== BACKUP_FORMAT) throw new BackupError('This is not a Droid Assist backup file.');
  if (data.version !== BACKUP_VERSION) throw new BackupError(`Unsupported backup version ${JSON.stringify(data.version)}; this app reads version ${BACKUP_VERSION}.`);
  if (typeof data.exportedAt !== 'string' || Number.isNaN(Date.parse(data.exportedAt))) throw new BackupError('The backup has no valid export date.');
  if (!isObject(data.stores)) throw new BackupError('The backup has no stores.');
  for (const [name, value] of Object.entries(data.stores)) {
    if (!Object.hasOwn(BACKUP_STORES, name)) throw new BackupError(`The backup contains an unknown store "${name}".`);
    checkStore(name as StoreName, value);
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: data.exportedAt, stores: data.stores as Backup['stores'] };
}

const watcherLists = (v: unknown): WatcherLists => {
  const o = isObject(v) ? v : {};
  return { notes: listEntries(o.notes), proposals: listEntries(o.proposals), tests: listEntries(o.tests) };
};
const listEntries = (v: unknown): Entry[] => (Array.isArray(v) ? v.filter(isEntry) : []);

/** The entries of a list store or of all three watcher lists. */
function entriesOf(name: StoreName, value: unknown): Entry[] {
  return BACKUP_STORES[name].shape === 'watcher' ? Object.values(watcherLists(value)).flat() : listEntries(value);
}

/** What the backup contains, one line per store present in it. */
export function summarizeBackup(backup: Backup): StoreSummary[] {
  return STORE_NAMES.filter((name) => backup.stores[name] !== undefined).map((name) => ({
    store: name,
    label: BACKUP_STORES[name].label,
    count: BACKUP_STORES[name].shape === 'settings' ? 1 : entriesOf(name, backup.stores[name]).length,
  }));
}

/** Local entries a replace would drop: ids missing from the file, or newer locally than in the file. */
export function replaceLosses(backup: Backup, storage: Pick<Storage, 'getItem'> = localStorage): StoreLoss[] {
  const losses: StoreLoss[] = [];
  for (const name of STORE_NAMES) {
    if (backup.stores[name] === undefined || BACKUP_STORES[name].shape === 'settings') continue;
    const incoming = new Map(entriesOf(name, backup.stores[name]).map((e) => [e.id, e]));
    const local = entriesOf(name, readStored(storage, BACKUP_STORES[name].key));
    const localOnly = local.filter((e) => !incoming.has(e.id)).length;
    const localNewer = local.filter((e) => { const f = incoming.get(e.id); return !!f && stampOf(e) > stampOf(f); }).length;
    if (localOnly || localNewer) losses.push({ store: name, label: BACKUP_STORES[name].label, localOnly, localNewer });
  }
  return losses;
}

/** Union by id, newest first; on a shared id the newer entry wins, the local one on a tie. */
export function unionById(local: Entry[], incoming: Entry[]): Entry[] {
  const byId = new Map<string, Entry>(incoming.map((e) => [e.id, e]));
  for (const e of local) {
    const other = byId.get(e.id);
    if (!other || stampOf(e) >= stampOf(other)) byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) => stampOf(b) - stampOf(a));
}

/** The value a merge writes for one store. */
function mergeStore(name: StoreName, local: unknown, incoming: unknown): unknown {
  const { shape } = BACKUP_STORES[name];
  if (local === undefined) return incoming;
  if (shape === 'settings') return isObject(local) ? local : incoming;
  if (shape === 'list') return unionById(listEntries(local), listEntries(incoming));
  const a = watcherLists(local);
  const b = watcherLists(incoming);
  return { notes: unionById(a.notes, b.notes), proposals: unionById(a.proposals, b.proposals), tests: unionById(a.tests, b.tests) };
}

/** Writes every store in the backup; all or nothing — on a failed write the earlier ones are rolled back. */
export function restoreBackup(backup: Backup, mode: RestoreMode, storage: BackupStorage = localStorage) {
  const writes = STORE_NAMES.filter((name) => backup.stores[name] !== undefined).map((name) => {
    const { key } = BACKUP_STORES[name];
    const value = mode === 'merge' ? mergeStore(name, readStored(storage, key), backup.stores[name]) : backup.stores[name];
    return { key, label: BACKUP_STORES[name].label, previous: storage.getItem(key), json: JSON.stringify(value) };
  });
  const done: typeof writes = [];
  for (const w of writes) {
    try {
      storage.setItem(w.key, w.json);
      done.push(w);
    } catch {
      for (const d of done) {
        if (d.previous === null) storage.removeItem(d.key);
        else storage.setItem(d.key, d.previous);
      }
      throw new BackupError(`Restore failed writing ${w.label} — browser storage is full or unavailable. Nothing was changed.`);
    }
  }
}
