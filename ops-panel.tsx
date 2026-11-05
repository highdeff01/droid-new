import type { AssistEngine } from './use-assist.js';
import { OPS_AGENTS } from './operations.js';
import styles from './droid-assist.module.css';

const when = (t: number) => new Date(t).toLocaleTimeString();
const STATUS_TONE = { working: 'info', parked: 'warn', waiting: 'ok' } as const;

/**
 * The Operations agent group: each agent's loop-control checkbox, status, last command and report;
 * the recent reports and the before/after evidence trail.
 */
export function OperationsPanel({ engine }: { engine: AssistEngine }) {
  const { ops, opsRunning, settings, toggleStage, stopPlan } = engine;
  return (
    <section className={styles.panel} aria-label="Operations agents">
      <h3>Operations agents <small>{opsRunning ? 'running' : 'idle'} · {ops.agents.filter((a) => a.status === 'working').length} working</small></h3>
      {opsRunning && <button type="button" onClick={stopPlan}>Stop plan</button>}
      {!ops.reports.length && <p className={styles.muted}>Try "/ops click Save and make sure it worked" — the main AI delegates to these agents — or "/ops apply: click Save" to command one.</p>}
      <ul className={styles.log} aria-label="Operations agent status">
        {OPS_AGENTS.map((def) => {
          const a = ops.agents.find((x) => x.id === def.id);
          const status = a?.status ?? 'waiting';
          return (
            <li key={def.id} data-tone={settings.stages[def.stage] ? STATUS_TONE[status] : 'warn'}>
              <label>
                <input type="checkbox" aria-label={def.name} checked={settings.stages[def.stage]} onChange={(e) => toggleStage(def.stage, e.target.checked)} />
                <b>{def.name}</b>
              </label>{' '}
              {settings.stages[def.stage] ? status : 'disabled'}{a?.task ? ` — "${a.task}"` : ''}{a?.lastReport ? ` → ${a.lastReport}` : ''}
            </li>
          );
        })}
      </ul>
      {ops.evidence.length > 0 && (
        <details>
          <summary>Evidence trail <small>{ops.evidence.length}</small></summary>
          <ul className={styles.log} aria-label="Evidence trail">
            {ops.evidence.map((e) => (
              <li key={e.id} data-tone={e.verdict === 'effect' ? 'ok' : e.verdict === 'no-effect' ? 'error' : 'info'}>
                <time>{when(e.time)}</time> {e.action} "{e.step}" · {e.verdict ?? 'not rechecked'}
                {e.before && <img src={e.before} alt={`Before ${e.step}`} width={120} />}
                {e.after && <img src={e.after} alt={`After ${e.step}`} width={120} />}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
