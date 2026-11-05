import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { currentPath, hopText, pathRate, type AccessProfile, type PathVersion } from './access-paths.js';
import styles from './droid-assist.module.css';

const versionText = (v: PathVersion) => `v${v.version} · ${v.successes}/${v.uses} ok (${(pathRate(v) * 100).toFixed(0)}%)`;

/** One profile: its current path hop by hop, older versions with their frequency, edit, test-run and delete. */
function PathItem({ engine, p }: { engine: AssistEngine; p: AccessProfile }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const v = currentPath(p);
  const save = () => {
    const ok = engine.editAccessPath(p.id, draft ?? '');
    setInvalid(!ok);
    if (ok) setDraft(null);
  };
  return (
    <li data-tone="info">
      <b>{p.target}</b>{p.context ? <small> · {p.context}</small> : null} <small>· {versionText(v)}</small>
      {draft === null ? (
        <ol>{v.hops.map((h, i) => <li key={i}>{hopText(h)}</li>)}</ol>
      ) : (
        <>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.max(2, v.hops.length)} aria-label={`Path to ${p.target}`} />
          {invalid ? <small role="alert"> One hop per line: label @ x%, y% (add ×2 for a double click)</small> : null}
          <button type="button" onClick={save}>Save path</button>
          <button type="button" onClick={() => { setDraft(null); setInvalid(false); }}>Cancel</button>
        </>
      )}
      {p.versions.length > 1 ? <small>Older paths: {p.versions.slice(1).map(versionText).join(' · ')}</small> : null}
      {draft === null ? <button type="button" onClick={() => setDraft(v.hops.map(hopText).join('\n'))}>Edit</button> : null}
      <button type="button" onClick={() => void engine.testAccessPath(p.id)} title="Runs the saved path through the same gates as Test click">Test run</button>
      <button type="button" aria-label={`Delete path to ${p.target}`} onClick={() => engine.deleteAccessPath(p.id)}>✕</button>
    </li>
  );
}

/** Access paths: the saved, versioned routes to each target, tried before fresh grounding. */
export function AccessPathsPanel({ engine }: { engine: AssistEngine }) {
  const { accessPaths, armed } = engine;
  return (
    <section className={styles.panel} aria-label="Access paths">
      <h3>Access paths <small>{accessPaths.length} target(s) · {armed ? 'test runs use real input' : 'disarmed: test runs are dry runs'}</small></h3>
      <p className={styles.muted}>Learned from successful runs. A step that needs a saved target follows its path first and only falls back to fresh grounding when a hop fails; a repaired path becomes a new version.</p>
      {accessPaths.length ? (
        <ul className={styles.log}>
          {accessPaths.map((p) => <PathItem key={p.id} engine={engine} p={p} />)}
        </ul>
      ) : <p className={styles.muted}>No access paths yet.</p>}
    </section>
  );
}
