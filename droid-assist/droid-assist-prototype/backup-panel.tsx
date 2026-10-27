import { useState, type ChangeEvent } from 'react';
import { downloadText } from './action-history.js';
import { BackupError, backupFileName, exportBackup, parseBackup, replaceLosses, restoreBackup, summarizeBackup, type Backup, type RestoreMode, type StoreLoss } from './backup.js';
import styles from './droid-assist.module.css';

/** The confirmation question for a replace that would drop local data. */
export function lossQuestion(losses: StoreLoss[]): string {
  const lines = losses.map((l) => `• ${l.label}: ${l.localOnly} only on this device, ${l.localNewer} newer here than in the file`);
  return `Replace will discard local data that is not in the backup:\n${lines.join('\n')}\n\nReplace anyway? (Choose Cancel and use Merge to keep it.)`;
}

/** Restores `backup` after asking when a replace would drop local-only or newer local data; false when declined. */
export function confirmAndRestore(backup: Backup, mode: RestoreMode, ask: (question: string) => boolean = (q) => window.confirm(q)): boolean {
  const losses = mode === 'replace' ? replaceLosses(backup) : [];
  if (losses.length && !ask(lossQuestion(losses))) return false;
  restoreBackup(backup, mode);
  return true;
}

/** Settings → Backup: export every learned store to one JSON file (through `onExport` when given), or validate and restore one. */
export function BackupSettings({ onExport }: { onExport?: () => void } = {}) {
  const [backup, setBackup] = useState<Backup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportAll = onExport ?? (() => downloadText(backupFileName(), JSON.stringify(exportBackup(), null, 2), 'application/json'));

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBackup(null);
    setError(null);
    try {
      setBackup(parseBackup(await file.text()));
    } catch (err) {
      setError(err instanceof BackupError ? err.message : `Could not read the file: ${String(err)}`);
    }
  };

  const restore = (mode: RestoreMode) => {
    if (!backup) return;
    try {
      // Reload so every store rehydrates from storage and stale in-memory state cannot overwrite it.
      if (confirmAndRestore(backup, mode)) window.location.reload();
    } catch (err) {
      setError(err instanceof BackupError ? err.message : `Restore failed: ${String(err)}`);
    }
  };

  return (
    <>
      <h3>Backup</h3>
      <button type="button" onClick={exportAll}>Export all learned data</button>
      <label className={styles.setting}>Import / restore a backup file
        <input type="file" accept="application/json,.json" onChange={(e) => void pick(e)} aria-label="Backup file" />
      </label>
      {error && <p role="alert" data-tone="error">{error}</p>}
      {backup && (
        <div aria-label="Backup contents">
          <small>Exported {new Date(backup.exportedAt).toLocaleString()} · version {backup.version}</small>
          <ul>{summarizeBackup(backup).map((s) => <li key={s.store}>{s.label}: {s.count}</li>)}</ul>
          <button type="button" onClick={() => restore('merge')}>Merge into local data</button>
          <button type="button" onClick={() => restore('replace')}>Replace local data</button>
        </div>
      )}
    </>
  );
}
