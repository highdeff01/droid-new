import { BACKUP_STORES, exportBackup, parseBackup, restoreBackup, type Backup, type StoreName } from './backup.js';

/** Where the last good export snapshot is kept. */
export const LAST_GOOD_KEY = 'droid-assist.last-good-export';
/** Marks a recovery file (the corrupted payloads a startup scan quarantined). */
export const RECOVERY_FORMAT = 'droid-assist-recovery';

/** Stores outside the backup set that are scanned too; all hold lists. */
const EXTRA_STORES = {
  triggers: { key: 'droid-assist.triggers', label: 'Triggers' },
  runs: { key: 'droid-assist.runs', label: 'Run summaries' },
  notifications: { key: 'droid-assist.notifications', label: 'Notifications' },
} as const;

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** One store whose payload could not be read. */
export interface CorruptStore {
  key: string;
  label: string;
  /** The raw stored text, kept verbatim in the recovery file. */
  raw: string;
  reason: string;
  /** What recovery did: restored from the last good export, or removed so the app starts from defaults. */
  fix: 'restored' | 'reset';
}

/** What one startup recovery run found and did. */
export interface RecoveryReport {
  time: number;
  corrupt: CorruptStore[];
  /** When the last good export used for restoring was taken; null when none existed. */
  lastGoodAt: string | null;
  /** Invalid IndexedDB frame records removed. */
  prunedFrames: number;
}

/** The recovery file of a report: every corrupted payload verbatim. */
export interface RecoveryFile {
  format: typeof RECOVERY_FORMAT;
  createdAt: string;
  stores: Array<Pick<CorruptStore, 'key' | 'label' | 'raw' | 'reason'>>;
}

const isObject = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Why a stored payload is corrupt for its shape, or null when it reads. */
function corruption(raw: string, shape: 'settings' | 'list' | 'watcher'): string | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return 'not valid JSON';
  }
  if (shape === 'list') return Array.isArray(value) ? null : 'expected a list';
  return isObject(value) ? null : 'expected an object';
}

/** Every scanned store: key, label, shape and (for backup stores) its backup name. */
function scannedStores() {
  const backed = (Object.keys(BACKUP_STORES) as StoreName[]).map((name) => ({ ...BACKUP_STORES[name], name: name as StoreName | null }));
  const extra = Object.values(EXTRA_STORES).map((s) => ({ ...s, shape: 'list' as const, name: null }));
  return [...backed, ...extra];
}

/** The last good export snapshot, or null when none is stored or it is unreadable. */
export function loadLastGood(storage: Pick<Storage, 'getItem'> = localStorage): Backup | null {
  const raw = storage.getItem(LAST_GOOD_KEY);
  if (raw === null) return null;
  try {
    return parseBackup(raw);
  } catch {
    return null;
  }
}

/** Keeps `backup` as the last good export; false when storage is full (best effort). */
export function saveLastGood(backup: Backup, storage: Pick<Storage, 'setItem'> = localStorage): boolean {
  try {
    storage.setItem(LAST_GOOD_KEY, JSON.stringify(backup));
    return true;
  } catch {
    return false;
  }
}

/** Snapshots every store as the last good export. */
export const snapshotLastGood = (storage: RecoveryStorage = localStorage, now = Date.now()) => saveLastGood(exportBackup(storage, now), storage);

/** The Settings Restore button: replaces every store with the last good export; null when there is none. Throws BackupError when a write fails. */
export function restoreLastGood(storage: RecoveryStorage = localStorage): Backup | null {
  const lastGood = loadLastGood(storage);
  if (lastGood) restoreBackup(lastGood, 'replace', storage);
  return lastGood;
}

/**
 * Startup recovery of localStorage: every store whose payload is corrupt is restored from the last
 * good export when that snapshot holds it, otherwise removed so the app starts from defaults.
 */
export function recoverStorage(storage: RecoveryStorage = localStorage, now = Date.now()): RecoveryReport {
  const lastGood = loadLastGood(storage);
  const corrupt: CorruptStore[] = [];
  for (const store of scannedStores()) {
    const raw = storage.getItem(store.key);
    const reason = raw === null ? null : corruption(raw, store.shape);
    if (raw === null || !reason) continue;
    const good = store.name ? lastGood?.stores[store.name] : undefined;
    if (good === undefined) storage.removeItem(store.key);
    else storage.setItem(store.key, JSON.stringify(good));
    corrupt.push({ key: store.key, label: store.label, raw, reason, fix: good === undefined ? 'reset' : 'restored' });
  }
  return { time: now, corrupt, lastGoodAt: lastGood?.exportedAt ?? null, prunedFrames: 0 };
}

/** The recovery file of a report's corrupted payloads. */
export function recoveryFile(report: RecoveryReport): RecoveryFile {
  return { format: RECOVERY_FORMAT, createdAt: new Date(report.time).toISOString(), stores: report.corrupt.map(({ key, label, raw, reason }) => ({ key, label, raw, reason })) };
}

/** The recovery file's download name. */
export const recoveryFileName = (now = Date.now()) => `droid-assist-recovery-${new Date(now).toISOString().replace(/[:.]/g, '-')}.json`;

/** One-line text of a recovery report. */
export function recoveryText(r: RecoveryReport): string {
  if (!r.corrupt.length && !r.prunedFrames) return 'All stores read cleanly';
  const parts = r.corrupt.map((c) => `${c.label} (${c.reason}) ${c.fix === 'restored' ? 'restored from the last good export' : 'reset to defaults'}`);
  if (r.prunedFrames) parts.push(`${r.prunedFrames} corrupt screenshot record(s) removed`);
  return `Recovered: ${parts.join('; ')}`;
}
