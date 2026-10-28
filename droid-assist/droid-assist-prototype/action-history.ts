import type { ActionRecord } from './types.js';

/** localStorage key of the persistent action history. */
export const HISTORY_KEY = 'droid-assist.action-history';
/** Newest records kept. */
export const HISTORY_LIMIT = 2000;

const CSV_COLUMNS: Array<keyof ActionRecord> = ['time', 'action', 'x', 'y', 'endX', 'endY', 'text', 'source', 'via', 'ok', 'message', 'dryRun'];

/** Reads the persisted history, newest first; an unreadable store yields an empty history. */
export function loadHistory(storage: Pick<Storage, 'getItem'> = localStorage): ActionRecord[] {
  try {
    const parsed = JSON.parse(storage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Prepends a record, trims to HISTORY_LIMIT and persists. Returns the new history. */
export function appendHistory(history: ActionRecord[], record: ActionRecord, storage: Pick<Storage, 'setItem'> = localStorage): ActionRecord[] {
  const next = [record, ...history].slice(0, HISTORY_LIMIT);
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Storage full or unavailable: keep the in-memory history.
  }
  return next;
}

/** Clears the persisted history. */
export function clearHistory(storage: Pick<Storage, 'removeItem'> = localStorage): ActionRecord[] {
  storage.removeItem(HISTORY_KEY);
  return [];
}

const csvCell = (value: unknown): string => {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** RFC 4180 CSV with a header row; time is ISO 8601. */
export function historyToCsv(history: ActionRecord[]): string {
  const rows = history.map((r) => CSV_COLUMNS.map((c) => csvCell(c === 'time' ? new Date(r.time).toISOString() : r[c])).join(','));
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n');
}

/** Pretty JSON array of the records. */
export function historyToJson(history: ActionRecord[]): string {
  return JSON.stringify(history, null, 2);
}

/** Saves text as a file download. */
export function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
