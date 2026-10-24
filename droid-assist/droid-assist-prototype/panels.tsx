import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { frameDistance } from './drift.js';
import { checkBridge } from './bridge.js';
import styles from './droid-assist.module.css';

/** The N most recent frames with frame-to-frame drift, plus the AI-picked frames shown to the user. */
export function ComparisonGallery({ engine }: { engine: AssistEngine }) {
  const { frames, pinned } = engine;
  return (
    <section className={styles.panel}>
      <h3>Comparison gallery <small>{frames.length} recent frames</small></h3>
      <div className={styles.gallery}>
        {frames.map((f, i) => {
          const d = frames[i + 1] ? frameDistance(frames[i + 1].data, f.data) : 0;
          return (
            <figure key={f.id} className={d > 0.04 ? styles.changed : ''}>
              <img src={f.url} alt={`Frame ${f.id}`} />
              <figcaption>#{f.id} · Δ {d.toFixed(3)}</figcaption>
            </figure>
          );
        })}
      </div>
      {pinned.length > 0 && (
        <>
          <h4>AI-selected screenshots <small>most informative state changes from the last run</small></h4>
          <div className={styles.gallery}>
            {pinned.map((f) => (
              <figure key={f.id} className={styles.pinned}>
                <img src={f.url} alt={`Selected frame ${f.id}`} />
                <figcaption>#{f.id}</figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** Live task assembly: the workflow's steps with status, drift and inline editing. */
export function WorkflowPanel({ engine }: { engine: AssistEngine }) {
  const { steps, setSteps, draftCard, setDraftCard } = engine;
  return (
    <section className={styles.panel}>
      <h3>Workflow <small>{steps.length} step(s)</small></h3>
      {!steps.length && <p className={styles.muted}>Record, or type a goal and press ✨ AI plan.</p>}
      <ol className={styles.steps}>
        {steps.map((s, i) => (
          <li key={s.id} data-status={s.status}>
            {s.refFrame ? <img src={s.refFrame.url} alt="" /> : <span className={styles.noThumb}>{s.action}</span>}
            <div>
              <input value={s.name} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label={`Step ${i + 1} name`} />
              <small>
                {s.action} @ {(s.x * 100).toFixed(0)}%,{(s.y * 100).toFixed(0)}% · {s.status}
                {s.drift !== undefined && ` · drift ${s.drift.toFixed(3)}`}
              </small>
            </div>
            <button type="button" aria-label="Remove step" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>✕</button>
          </li>
        ))}
      </ol>
      {draftCard && (
        <div className={styles.card}>
          <input value={draftCard.name} onChange={(e) => setDraftCard({ ...draftCard, name: e.target.value })} aria-label="Workflow name" />
          <textarea value={draftCard.description} onChange={(e) => setDraftCard({ ...draftCard, description: e.target.value })} aria-label="Workflow description" />
          <button type="button" className={styles.primary} onClick={engine.saveCard}>💾 Save</button>
        </div>
      )}
    </section>
  );
}

/** Saved workflow cards for comparison and later selection. */
export function LibraryPanel({ engine }: { engine: AssistEngine }) {
  return (
    <section className={styles.panel}>
      <h3>Saved workflows <small>{engine.cards.length}</small></h3>
      {!engine.cards.length && <p className={styles.muted}>Saved cards appear here. The planner reuses similar ones automatically.</p>}
      <div className={styles.cards}>
        {engine.cards.map((c) => (
          <button type="button" key={c.id} className={styles.savedCard} onClick={() => engine.loadCard(c)}>
            <strong>{c.name}</strong>
            <span>{c.description}</span>
            <small>{c.steps.length} steps · {new Date(c.savedAt).toLocaleTimeString()}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Watcher / monitor agents and settings (gallery size, drift checkpoints, capture rate, bridge). */
export function AgentsPanel({ engine }: { engine: AssistEngine }) {
  const { agents, setAgents, settings, setSettings } = engine;
  const [bridge, setBridge] = useState('');
  return (
    <section className={styles.panel}>
      <h3>Agents</h3>
      {agents.map((a) => (
        <label key={a.id} className={styles.agent}>
          <input type="checkbox" checked={a.on} onChange={(e) => setAgents(agents.map((x) => (x.id === a.id ? { ...x, on: e.target.checked } : x)))} />
          <span><strong>{a.name}</strong><small>{a.description}</small></span>
        </label>
      ))}
      <h3>Settings</h3>
      <label className={styles.setting}>Gallery frames <b>{settings.gallerySize}</b>
        <input type="range" min={4} max={30} value={settings.gallerySize} onChange={(e) => setSettings({ ...settings, gallerySize: +e.target.value })} />
      </label>
      <label className={styles.setting}>Drift checkpoints per move <b>{settings.checkpoints}</b>
        <input type="range" min={1} max={20} value={settings.checkpoints} onChange={(e) => setSettings({ ...settings, checkpoints: +e.target.value })} />
      </label>
      <label className={styles.setting}>Capture every <b>{settings.captureMs} ms</b>
        <input type="range" min={250} max={2000} step={50} value={settings.captureMs} onChange={(e) => setSettings({ ...settings, captureMs: +e.target.value })} />
      </label>
      <label className={styles.setting}>Desktop bridge URL (pyautogui)
        <span className={styles.row}>
          <input value={settings.bridgeUrl} onChange={(e) => setSettings({ ...settings, bridgeUrl: e.target.value })} placeholder="http://127.0.0.1:3000" />
          <button type="button" onClick={async () => setBridge((await checkBridge(settings.bridgeUrl)).message)} disabled={!settings.bridgeUrl}>Test</button>
        </span>
        {bridge && <small>{bridge}</small>}
      </label>
    </section>
  );
}

/** Action record: everything the user, AI, and agents did. */
export function LogPanel({ engine }: { engine: AssistEngine }) {
  return (
    <section className={styles.panel}>
      <h3>Activity log</h3>
      <ul className={styles.log}>
        {engine.log.map((l) => (
          <li key={l.id} data-tone={l.tone}>
            <time>{new Date(l.time).toLocaleTimeString()}</time> <b>{l.source}</b> {l.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
