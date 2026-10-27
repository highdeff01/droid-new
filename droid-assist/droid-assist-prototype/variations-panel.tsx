import type { AssistEngine } from './use-assist.js';
import type { LogEntry } from './types.js';
import type { Variation, VariationStatus } from './variations.js';
import styles from './droid-assist.module.css';

const STATUS_TONE: Record<VariationStatus, LogEntry['tone']> = { running: 'info', paused: 'warn', done: 'ok', failed: 'error' };

const doneCount = (v: Variation) => v.steps.filter((s) => s.status === 'done').length;

/** One background variation: status, progress and its controls. */
function VariationRow({ engine, v }: { engine: AssistEngine; v: Variation }) {
  const api = engine.variations;
  return (
    <li data-tone={STATUS_TONE[v.status]} aria-label={`Variation ${v.goal}`}>
      <b>{v.status}</b> {v.goal} <small>· {doneCount(v)}/{v.steps.length} step(s) · {v.reason}</small>
      <div className={styles.row}>
        {v.status === 'running'
          ? <button type="button" onClick={() => api.pause(v.id)}>Pause</button>
          : <button type="button" onClick={() => api.resume(v.id)} disabled={v.status === 'done'}>Resume</button>}
        <button type="button" onClick={() => api.switchTo(v.id)}>Switch focus</button>
        <button type="button" onClick={() => api.merge(v.id)}>Merge</button>
        <button type="button" onClick={() => api.discard(v.id)}>Discard</button>
      </div>
    </li>
  );
}

/** Background variations of the project: list, status, switch focus, merge back or discard. */
export function VariationsPanel({ engine }: { engine: AssistEngine }) {
  const { variations, held, startVariation } = engine.variations;
  const running = variations.filter((v) => v.status === 'running').length;
  return (
    <section className={styles.panel}>
      <h3>Variations <small>{running} running · {variations.length} total</small></h3>
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
