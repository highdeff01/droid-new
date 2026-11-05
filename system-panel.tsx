import { useEffect, useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import type { FolderSpec, SystemInfo } from './electron/system-api.js';
import { SYSTEM_REFRESH_SEC_RANGE, formatBytes, formatUptime, recentOperations } from './system-info.js';
import styles from './droid-assist.module.css';

/** The current time and date, ticking every second. */
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return <p aria-label="Current time">{now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} · <b>{now.toLocaleTimeString()}</b></p>;
}

/** OS, CPU, memory, displays, uptime and disk. */
function ComputerInfo({ info }: { info: SystemInfo | null }) {
  if (!info) return <p className={styles.muted}>Reading system info…</p>;
  const { memory, disk } = info;
  return (
    <ul className={styles.log} aria-label="Computer info">
      <li><b>OS</b> {info.os} <small>· {info.arch}</small></li>
      <li><b>CPU</b> {info.cpu.model} <small>· {info.cpu.cores} core(s)</small></li>
      <li><b>Memory</b> {formatBytes(memory.freeBytes)} free of {formatBytes(memory.totalBytes)}</li>
      <li><b>Displays</b> {info.displays.length ? info.displays.map((d) => `${d.label} ${d.width}×${d.height}${d.primary ? ' (primary)' : ''}`).join(', ') : 'unknown'}</li>
      <li><b>Uptime</b> {formatUptime(info.uptimeSec)} <small>· {info.uptimeOf === 'system' ? 'system' : 'this session (browser)'}</small></li>
      {disk && <li><b>Disk</b> {formatBytes(disk.freeBytes)} free of {formatBytes(disk.totalBytes)}</li>}
      <li><small>Source: {info.source === 'electron' ? 'Electron (native)' : 'browser (navigator fallback)'}</small></li>
    </ul>
  );
}

/** One watched folder: size, counts and recent modifications. */
function FolderRow({ spec, onRemove }: { spec: FolderSpec; onRemove: () => void }) {
  return (
    <li data-tone={spec.error ? 'error' : 'info'}>
      <b>{spec.path}</b> <button type="button" onClick={onRemove} aria-label={`Stop watching ${spec.path}`}>✕</button>
      {spec.error ? <small> · {spec.error}</small> : (
        <>
          <small> · {formatBytes(spec.sizeBytes)} · {spec.files} file(s) · {spec.folders} folder(s){spec.truncated ? ' (partial scan)' : ''}</small>
          <ol>{spec.recent.map((f) => <li key={f.path}>{f.path} <small>· {new Date(f.modified).toLocaleString()} · {formatBytes(f.size)}</small></li>)}</ol>
        </>
      )}
    </li>
  );
}

/** System: computer info, folder specs, recent operations and the clock; refreshed on an interval and on demand. */
export function SystemPanel({ engine }: { engine: AssistEngine }) {
  const { system, settings, setSettings, runs } = engine;
  const [note, setNote] = useState<string | null>(null);
  const [min, max] = SYSTEM_REFRESH_SEC_RANGE;
  const addFolder = async () => setNote(await system.addFolder());
  return (
    <section className={styles.panel} aria-label="System">
      <h3>System <small>{system.refreshedAt ? `updated ${new Date(system.refreshedAt).toLocaleTimeString()}` : 'not read yet'}</small></h3>
      <Clock />
      <span className={styles.row}>
        <button type="button" onClick={() => void system.refresh()}>Refresh</button>
        <label>every <input type="number" min={min} max={max} value={settings.systemRefreshSec} onChange={(e) => setSettings({ ...settings, systemRefreshSec: Math.min(max, Math.max(min, e.target.valueAsNumber || min)) })} aria-label="System refresh seconds" /> s</label>
      </span>
      <ComputerInfo info={system.info} />
      <h4>Folders <button type="button" onClick={() => void addFolder()}>Add folder</button></h4>
      {note && <small>{note}</small>}
      {!system.folders.length && <p className={styles.muted}>Pick a folder to see its size, file count and recent changes.</p>}
      <ul className={styles.log}>{system.folders.map((f) => <FolderRow key={f.path} spec={f} onRemove={() => system.removeFolder(f.path)} />)}</ul>
      <h4>Recent operations</h4>
      {!runs.length && <p className={styles.muted}>No runs recorded yet.</p>}
      <ol aria-label="Recent operations">
        {recentOperations(runs).map((r) => <li key={r.id}>{new Date(r.time).toLocaleString()} · <b>{r.goal || '(no goal)'}</b> <small>· {r.outcome} · {r.succeeded}/{r.attempted} step(s)</small></li>)}
      </ol>
    </section>
  );
}
