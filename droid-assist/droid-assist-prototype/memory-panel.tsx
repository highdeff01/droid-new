import { useMemo, useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { currentPosition, dossierLine, type PositionDossier } from './position-dossier.js';
import { MEMORY_STATUSES, memoryFor, type MemoryEntry, type MemoryKind } from './enhanced-memory.js';
import styles from './droid-assist.module.css';

const KIND_LABEL: Record<MemoryKind, string> = { method: 'Method', usage: 'Element usage', path: 'Path', goal: 'Goal', position: 'Position' };
const STATUS_TONE: Record<MemoryEntry['status'], string> = { blacklisted: 'error', important: 'ok', recent: 'info' };

/** The memory entries of one status, newest first. */
function MemoryRows({ items }: { items: MemoryEntry[] }) {
  if (!items.length) return <p className={styles.muted}>Nothing here.</p>;
  return (
    <ul className={styles.log}>
      {items.map((m, i) => (
        <li key={`${m.from}-${m.time}-${i}`} data-tone={STATUS_TONE[m.status]}>
          <b>{KIND_LABEL[m.kind]}</b> <span>{m.text}</span> <small>· {new Date(m.time).toLocaleString()}</small>
        </li>
      ))}
    </ul>
  );
}

/** Each tracked element's dossier, with a button to prefer (or stop preferring) its current position. */
function DossierRows({ dossiers, prefer }: { dossiers: PositionDossier[]; prefer: AssistEngine['preferPosition'] }) {
  if (!dossiers.length) return <p className={styles.muted}>No tracked positions yet.</p>;
  return (
    <ul className={styles.log}>
      {dossiers.map((d) => (
        <li key={d.id}>
          <span>{dossierLine(d)}</span>{' '}
          <button type="button" onClick={() => prefer(d.name, d.preferred ? null : currentPosition(d))}>{d.preferred ? 'Clear preferred' : 'Prefer current'}</button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The cross-referenced memory view: methods, element usage, paths, goals and positions from the
 * habits, patterns, run statistics, agent tests and position dossiers, queryable by operation.
 */
export function MemoryPanel({ engine }: { engine: AssistEngine }) {
  const [query, setQuery] = useState('');
  const operation = query.trim() || engine.goal;
  const shown = useMemo(() => (operation.trim() ? memoryFor(engine.memory, operation) : engine.memory), [engine.memory, operation]);
  return (
    <section className={styles.panel} aria-label="Memory">
      <h3>Memory <small>{engine.memory.length} entr{engine.memory.length === 1 ? 'y' : 'ies'} · {engine.dossiers.length} tracked position(s)</small></h3>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={engine.goal || 'Operation to look up…'} aria-label="Operation to look up" />
      <p className={styles.muted}>{operation.trim() ? `Injected into the AI's context for "${operation}"` : 'All memory, newest first'}</p>
      {MEMORY_STATUSES.map((status) => (
        <div key={status}>
          <h4>{status[0].toUpperCase() + status.slice(1)}</h4>
          <MemoryRows items={shown.filter((m) => m.status === status)} />
        </div>
      ))}
      <h4>Tracked positions</h4>
      <DossierRows dossiers={engine.dossiers} prefer={engine.preferPosition} />
    </section>
  );
}
