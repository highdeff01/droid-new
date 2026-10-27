import type { AssistEngine } from './use-assist.js';
import { BUS_AGENTS, BUS_AGENT_IDS, inbox } from './agent-bus.js';
import { tally, type SubagentStatus } from './subagents.js';
import styles from './droid-assist.module.css';

const TONE: Record<SubagentStatus, 'ok' | 'error' | 'warn' | 'info'> = { pass: 'ok', fail: 'error', aborted: 'warn', skipped: 'info' };

/** The inter-agent bus: each agent's inbox of forwarded elements, with timestamps and what it did. */
export function AgentBusPanel({ engine }: { engine: AssistEngine }) {
  const { bus, knownElements } = engine;
  return (
    <section className={styles.panel} aria-label="Agent bus">
      <h3>Agent bus <small>{bus.length} message(s) · {knownElements.length} predefined</small></h3>
      {!bus.length && <p className={styles.muted}>Elements an agent discovers are forwarded here to the other agents.</p>}
      {BUS_AGENT_IDS.map((id) => {
        const box = inbox(bus, id);
        if (!box.length) return null;
        return (
          <details key={id} open>
            <summary>{BUS_AGENTS[id]} <small>{box.filter((m) => m.status === 'queued').length} queued</small></summary>
            <ul className={styles.log}>
              {box.map((m) => (
                <li key={m.id} data-tone={m.status === 'handled' ? 'ok' : 'info'}>
                  <time>{new Date(m.time).toLocaleTimeString()}</time> <b>{BUS_AGENTS[m.from]}</b> "{m.element.name}" · {m.status}{m.note ? ` — ${m.note}` : ''}
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </section>
  );
}

/** The latest link/route test: one row per subagent with pass/fail, screenshots and thinking. */
export function SubagentReportPanel({ engine }: { engine: AssistEngine }) {
  const { subReport, subRunning } = engine;
  const counts = subReport ? tally(subReport.results) : null;
  return (
    <section className={styles.panel} aria-label="Subagent report">
      <h3>Link / route tests {counts && <small>{counts.pass} pass · {counts.fail} fail · {counts.aborted} aborted · {counts.skipped} skipped</small>}</h3>
      {subRunning && <button type="button" onClick={() => void engine.invoke('replay.stop')}>Stop subagents</button>}
      {!subReport && <p className={styles.muted}>Try "/test links Files, Notes" or "/test route Cart &gt; Checkout &gt; Pay".</p>}
      {subReport && <p className={styles.muted}>{subReport.goal}{subReport.finished ? '' : ' — running…'}</p>}
      <ul className={styles.log}>
        {subReport?.results.map((r) => (
          <li key={r.id} data-tone={TONE[r.status]}>
            <b>{r.status.toUpperCase()}</b> {r.label} <small>budget {r.budget}{r.dry ? ' · dry run' : ''}</small> — {r.message}
            {r.shots.map((f) => <img key={f.id} src={f.url} alt={`After ${r.label}`} width={96} />)}
            {r.thinking.map((t, i) => <details key={i}><summary>Thinking</summary><pre>{t}</pre></details>)}
          </li>
        ))}
      </ul>
    </section>
  );
}
