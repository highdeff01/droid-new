import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { timestamp } from './video-notes.js';
import styles from './droid-assist.module.css';

/** Invokes one registered capability as the user with JSON parameters. */
function InvokeForm({ engine }: { engine: AssistEngine }) {
  const ids = [...engine.capabilities.keys()];
  const [id, setId] = useState(ids[0] ?? '');
  const [params, setParams] = useState('{}');
  const run = () => {
    try {
      void engine.invokeCapability({ kind: 'user' }, id, JSON.parse(params) as Record<string, unknown>);
    } catch {
      engine.addLog('Capabilities', `Parameters for ${id} are not valid JSON`, 'warn');
    }
  };
  const cap = engine.capabilities.get(id);
  return (
    <div>
      <select value={id} onChange={(e) => setId(e.target.value)} aria-label="Capability">
        {ids.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input value={params} onChange={(e) => setParams(e.target.value)} aria-label="Parameters (JSON)" />
      <button type="button" onClick={run}>Invoke</button>
      {cap && <p className={styles.muted}>{cap.description} — {cap.params.map((p) => `${p.name}${p.required ? '' : '?'}: ${p.type}`).join(', ')}</p>}
    </div>
  );
}

/** The capability registry: invoke any capability, and the saved presentations, scripts and knowledge notes. */
export function CapabilitiesPanel({ engine }: { engine: AssistEngine }) {
  return (
    <section className={styles.panel} aria-label="Capabilities">
      <h3>Capabilities <small>{engine.capabilities.size} registered · also /do</small></h3>
      <InvokeForm engine={engine} />
      <h4>Presentations</h4>
      {!engine.presentations.length && <p className={styles.muted}>None saved yet.</p>}
      <ul className={styles.log}>
        {engine.presentations.map((p) => <li key={p.id} data-tone={p.status === 'done' ? 'ok' : 'warn'}><b>{p.name}</b> <small>{p.status} · {p.slides.length} slide(s)</small></li>)}
      </ul>
      <h4>Scripts</h4>
      {!engine.scripts.length && <p className={styles.muted}>None saved yet.</p>}
      <ul className={styles.log}>
        {engine.scripts.map((s) => <li key={s.id}><b>{s.name}</b> <small>{s.steps.length} step(s){s.description ? ` · ${s.description}` : ''}</small></li>)}
      </ul>
      <h4>Knowledge</h4>
      {!engine.knowledge.length && <p className={styles.muted}>No notes yet.</p>}
      <ul className={styles.log}>
        {engine.knowledge.map((k) => (
          <li key={k.id}><b>{k.title}</b>
            <ol>{k.notes.map((n, i) => <li key={i}>[{timestamp(n.offsetMs)}] {n.text}{n.screenshot && <img src={n.screenshot} alt={`Moment at ${timestamp(n.offsetMs)}`} width={120} />}</li>)}</ol>
          </li>
        ))}
      </ul>
    </section>
  );
}
