import type { AssistEngine } from './use-assist.js';
import type { LogEntry } from './types.js';
import { isClosed, type Variation, type VariationStatus } from './variations.js';
import styles from './droid-assist.module.css';

const STATUS_TONE: Record<VariationStatus, LogEntry['tone']> = {
  running: 'info', paused: 'warn', done: 'ok', failed: 'error', merged: 'ok', discarded: 'warn',
};

const doneCount = (v: Variation) => v.steps.filter((s) => s.status === 'done').length;

const countOf = (variations: Variation[], status: VariationStatus) => variations.filter((v) => v.status === status).length;

/** Pause for a running variation, Resume for any other open one (disabled once it has nothing left to run). */
function RunToggle({ engine, v }: { engine: AssistEngine; v: Variation }) {
  const api = engine.variations;
  if (v.status === 'running') return <button type="button" onClick={() => api.pause(v.id)}>Pause</button>;
  return <button type="button" onClick={() => api.resume(v.id)} disabled={v.status === 'done'}>Resume</button>;
}

/** One background variation: status, progress and its controls; a merged or discarded one is listed without controls. */
function VariationRow({ engine, v }: { engine: AssistEngine; v: Variation }) {
  const api = engine.variations;
  return (
    <li data-tone={STATUS_TONE[v.status]} data-status={v.status} aria-label={`Variation ${v.goal}`}>
      <b>{v.status}</b> {v.goal} <small>· {doneCount(v)}/{v.steps.length} step(s) · {v.reason}</small>
      {!isClosed(v) && (
        <div className={styles.row}>
          <RunToggle engine={engine} v={v} />
          <button type="button" onClick={() => api.switchTo(v.id)}>Switch focus</button>
          <button type="button" onClick={() => api.merge(v.id)}>Merge</button>
          <button type="button" onClick={() => api.discard(v.id)}>Discard</button>
        </div>
      )}
    </li>
  );
}

/** Background variations of the project: list, status, switch focus, merge back or discard. */
export function VariationsPanel({ engine }: { engine: AssistEngine }) {
  const { variations, held, startVariation } = engine.variations;
  const running = countOf(variations, 'running');
  const counts = `${running} running · ${countOf(variations, 'paused')} paused · ${countOf(variations, 'merged')} merged · ${countOf(variations, 'discarded')} discarded`;
  return (
    <section className={styles.panel}>
      <h3>Variations <small>{counts} · {variations.length} total</small></h3>
      <div className={styles.row}>
        <button type="button" onClick={startVariation}>New variation</button>
      </div>
      {held && running > 0 && <p className={styles.muted} role="status">{held}</p>}
      {!variations.length && <p className={styles.muted}>A superseded goal, or the current one when you start a new variation, keeps running here in the background with its own portfolio.</p>}
      <ul className={styles.log} aria-label="Background variations">
        {variations.map((v) => <VariationRow key={v.id} engine={engine} v={v} />)}
      </ul>
    </section>
  );
}
