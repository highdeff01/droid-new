import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { blacklistLine, type OperationGroup } from './operation-memory.js';
import styles from './droid-assist.module.css';

const when = (t: number) => new Date(t).toLocaleString();

/** The user's notes for one operation, each forgettable, and a form to add one. */
function NoteList({ group, engine }: { group: OperationGroup; engine: AssistEngine }) {
  const [text, setText] = useState('');
  const add = () => {
    engine.addOperationNote(group.operation, text);
    setText('');
  };
  return (
    <>
      <h4>Notes <small>{group.notes.length}</small></h4>
      <ul className={styles.log} aria-label={`Notes for ${group.operation}`}>
        {group.notes.map((n) => (
          <li key={n.id}>
            {n.text} <small>· {when(n.time)}</small>
            <button type="button" aria-label={`Forget note ${n.text}`} onClick={() => engine.forgetMemory(n.id)}>✕</button>
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input aria-label={`New note for ${group.operation}`} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={!text.trim()}>Add note</button>
      </form>
    </>
  );
}

/** Failure reminders of one operation: what failed, who ran it, when, and its screenshots. */
function FailureList({ group, engine }: { group: OperationGroup; engine: AssistEngine }) {
  return (
    <>
      <h4>Failures <small>{group.failures.length}</small></h4>
      <ul className={styles.log} aria-label={`Failures for ${group.operation}`}>
        {group.failures.map((f) => (
          <li key={f.id} data-tone="error">
            <b>{f.what}</b> <small>· {f.actor} · {when(f.time)}</small>
            <button type="button" aria-label={`Forget failure ${f.what}`} onClick={() => engine.forgetMemory(f.id)}>✕</button>
            {f.shots.map((src, i) => <img key={i} src={src} alt="Failure screenshot" width={160} />)}
          </li>
        ))}
      </ul>
    </>
  );
}

/** One operation's notes, failures, blacklist and successful runs. */
function OperationBlock({ group, engine }: { group: OperationGroup; engine: AssistEngine }) {
  return (
    <article aria-label={`Operation ${group.operation}`}>
      <h3>{group.operation}</h3>
      <NoteList group={group} engine={engine} />
      <FailureList group={group} engine={engine} />
      <h4>Blacklist <small>{group.blacklist.length}</small></h4>
      <ul className={styles.log} aria-label={`Blacklist for ${group.operation}`}>
        {group.blacklist.map((e) => <li key={`${e.source}|${e.text}`} data-tone="warn">{blacklistLine(e)}</li>)}
      </ul>
      <h4>Successes <small>{group.successes.length}</small></h4>
      <ul className={styles.log} aria-label={`Successes for ${group.operation}`}>
        {group.successes.map((r) => <li key={r.id} data-tone="ok">{r.goal} <small>· {when(r.time)}</small></li>)}
      </ul>
    </article>
  );
}

/** Per-operation memory, recallable: notes, failure reminders with screenshots, blacklists and successes. */
export function OperationMemoryPanel({ engine }: { engine: AssistEngine }) {
  return (
    <section className={styles.panel} aria-label="Operation memory">
      <h3>Operation memory <small>{engine.operations.length}</small></h3>
      {!engine.operations.length && <p className={styles.muted}>No operations remembered yet. Failed runs, notes and successful runs appear here per operation.</p>}
      {engine.operations.map((g) => <OperationBlock key={g.operation} group={g} engine={engine} />)}
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
