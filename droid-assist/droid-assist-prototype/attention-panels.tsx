import type { AssistEngine } from './use-assist.js';
import { latestReports, type AgentReport } from './agent-cadence.js';
import { isPopupEntry, isPopupLine } from './attention.js';
import styles from './droid-assist.module.css';

const clock = (t: number) => new Date(t).toLocaleTimeString();
/** Popup log entries shown at once. */
const POPUP_SHOWN = 20;

const reportItem = (r: AgentReport) => (
  <li key={r.agent}><b>{r.name}</b> <small>{clock(r.time)}</small> — {r.text}</li>
);

/**
 * The current operation: what the AI is focused on (and who put it there), its latest answer
 * (auto point-out included), and every agent's newest live report except the popup watcher's.
 */
export function CurrentOperationPanel({ engine }: { engine: AssistEngine }) {
  const { attention, aiAnswer, pointOutAuto } = engine;
  const reports = latestReports(engine.agentReports).filter((r) => !isPopupLine(`${r.name} ${r.text}`));
  return (
    <section className={styles.panel} aria-label="Current operation">
      <h3>Current operation</h3>
      <p aria-label="AI attention"><b>Focus:</b> {attention.focus} <small>· {attention.source}{attention.since ? ` · since ${clock(attention.since)}` : ''}</small></p>
      {pointOutAuto && <p><small>Point out runs every 5 s</small></p>}
      {aiAnswer ? <p aria-label="Latest AI answer">{aiAnswer}</p> : <p className={styles.muted}>No AI answer yet.</p>}
      <h4>Agents now</h4>
      {reports.length ? <ul aria-label="Agent reports">{reports.map(reportItem)}</ul> : <p className={styles.muted}>No agent has reported yet.</p>}
    </section>
  );
}

/** The popup scope: the popup watcher's live report and every popup log entry, kept out of the other tabs. */
export function PopupPanel({ engine }: { engine: AssistEngine }) {
  const live = latestReports(engine.agentReports).filter((r) => r.agent === 'popup');
  const entries = engine.log.filter(isPopupEntry).slice(0, POPUP_SHOWN);
  return (
    <section className={styles.panel} aria-label="Popups">
      <h3>Popups</h3>
      {live.length ? <ul aria-label="Popup watcher report">{live.map(reportItem)}</ul> : <p className={styles.muted}>The popup watcher has not reported yet.</p>}
      <ul aria-label="Popup log">
        {entries.map((l) => <li key={l.id} data-tone={l.tone}><small>{clock(l.time)}</small> [{l.source}] {l.message}</li>)}
      </ul>
    </section>
  );
}
