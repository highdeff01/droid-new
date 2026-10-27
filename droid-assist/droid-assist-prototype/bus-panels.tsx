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

/** The agent crew: each agent's status, its last command and report; plus the live drag swarm and its controls. */
export function CrewPanel({ engine }: { engine: AssistEngine }) {
  const { crew, crewRunning, swarm, liveDragging, stopPlan, interveneDrag } = engine;
  return (
    <section className={styles.panel} aria-label="Agent crew">
      <h3>Agent crew <small>{crewRunning ? 'running' : 'idle'} · {crew.filter((a) => a.status === 'working').length} working</small></h3>
      {crewRunning && <button type="button" onClick={stopPlan}>Stop plan</button>}
      {!crewRunning && !crew.some((a) => a.task) && <p className={styles.muted}>Try "/crew find the Save button and the Files icon" — the main AI commands the agents.</p>}
      <ul className={styles.log}>
        {crew.map((a) => (
          <li key={a.id} data-tone={a.status === 'working' ? 'info' : a.status === 'parked' ? 'warn' : 'ok'}>
            <b>{a.id}</b> {a.status}{a.task ? ` — "${a.task}"` : ''}{a.lastReport ? ` → ${a.lastReport}` : ''}
          </li>
        ))}
      </ul>
      {swarm.length > 0 && (
        <details open={liveDragging}>
          <summary>Live drag swarm <small>{swarm.length} coordinate agents{liveDragging ? ' · dragging' : ''}</small></summary>
          {liveDragging && <button type="button" onClick={() => interveneDrag(null)}>Release now</button>}
          <ol className={styles.log}>
            {swarm.map((a) => <li key={a.index}>({(a.point.x * 100).toFixed(1)}%, {(a.point.y * 100).toFixed(1)}%) <small>match {a.match.toFixed(3)}</small></li>)}
          </ol>
        </details>
      )}
    </section>
  );
}

/** The latest link/route test: one row per subagent with pass/fail, screenshots and thinking. */
export function SubagentReportPanel({ engine }: { engine: AssistEngine }) {
  const { subReport, subRunning, stop } = engine;
  const counts = subReport ? tally(subReport.results) : null;
  return (
    <section className={styles.panel} aria-label="Subagent report">
      <h3>Link / route tests {counts && <small>{counts.pass} pass · {counts.fail} fail · {counts.aborted} aborted · {counts.skipped} skipped</small>}</h3>
      {subRunning && <button type="button" onClick={stop}>Stop subagents</button>}
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
