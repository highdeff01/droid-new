import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { blacklistLine, type OperationGroup } from './operation-memory.js';
import { opsAgent } from './operations.js';
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

/** What the Operations agents did for one operation: their reports, the evidence trail and the tagged log. */
function OpsSection({ group, engine }: { group: OperationGroup; engine: AssistEngine }) {
  const { reports, evidence, log } = engine.opsFor(group.operation);
  if (!reports.length && !evidence.length && !log.length) return null;
  return (
    <>
      <h4>Operations agents <small>{reports.length} report(s) · {evidence.length} evidence · {log.length} log entr{log.length === 1 ? 'y' : 'ies'}</small></h4>
      <ul className={styles.log} aria-label={`Operations reports for ${group.operation}`}>
        {reports.map((r) => <li key={r.id} data-tone={r.ok ? 'ok' : 'warn'}><b>{opsAgent(r.agent).name}</b> on "{r.task}": {r.found}</li>)}
        {evidence.map((e) => (
          <li key={e.id} data-tone={e.verdict === 'no-effect' ? 'error' : 'info'}>
            Evidence: {e.action} "{e.step}" · {e.verdict ?? 'not rechecked'}
            {e.before && <img src={e.before} alt={`Before ${e.step}`} width={120} />}
            {e.after && <img src={e.after} alt={`After ${e.step}`} width={120} />}
          </li>
        ))}
      </ul>
      <ul className={styles.log} aria-label={`Tagged log for ${group.operation}`}>
        {log.map((l) => <li key={l.id} data-tone={l.tone}>[{l.source}] {l.message}{l.repeat ? ` ×${l.repeat}` : ''}</li>)}
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
      <OpsSection group={group} engine={engine} />
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
    </section>
  );
}
