import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { BUS_AGENTS, BUS_AGENT_IDS, inbox } from './agent-bus.js';
import { tally, type SubagentStatus } from './subagents.js';
import { reporterName } from './resolution-center.js';
import { RECOVERY_OPS, RECOVERY_OP_KINDS, type RecoveryOpKind } from './recovery-ops.js';
import { downloadText } from './action-history.js';
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

/** The recovery operation picker: one operation, its argument and Run. */
function RecoveryControls({ engine }: { engine: AssistEngine }) {
  const [op, setOp] = useState<RecoveryOpKind>('retry');
  const [arg, setArg] = useState('');
  const spec = RECOVERY_OPS[op];
  return (
    <form onSubmit={(e) => { e.preventDefault(); void engine.resolution.runOp(op, arg); }}>
      <select aria-label="Recovery operation" value={op} onChange={(e) => setOp(e.target.value as RecoveryOpKind)}>
        {RECOVERY_OP_KINDS.map((k) => <option key={k} value={k}>{RECOVERY_OPS[k].label}{RECOVERY_OPS[k].admin ? ' (approval)' : ''}</option>)}
      </select>
      {spec.arg && <input aria-label="Operation argument" placeholder={spec.arg} value={arg} onChange={(e) => setArg(e.target.value)} />}
      <button type="submit">Run</button>
      <p className={styles.muted}>{spec.description}</p>
    </form>
  );
}

/** The AI resolution center: open disagreements, resolutions, recovery operations and the approval queue. */
export function ResolutionPanel({ engine }: { engine: AssistEngine }) {
  const { disagreements, resolutions, resolving, resolveAll, approvals, ops, scaffolds, approve, reject } = engine.resolution;
  const pending = approvals.filter((a) => a.status === 'pending');
  return (
    <section className={styles.panel} aria-label="Resolution center">
      <h3>Resolution center <small>{disagreements.length} disagreement(s) · {pending.length} awaiting approval</small></h3>
      <button type="button" disabled={resolving} onClick={() => void resolveAll()}>{resolving ? 'Resolving…' : 'Resolve disagreements'}</button>
      <ul className={styles.log}>
        {disagreements.map((d) => (
          <li key={d.id} data-tone="warn">"{d.element}" — {d.reports.map((r) => reporterName(r.reporter)).join(' vs ')} <small>spread {d.spread.toFixed(3)}</small></li>
        ))}
        {resolutions.map((r) => (
          <li key={r.id} data-tone={r.winner ? 'ok' : 'warn'}><time>{new Date(r.time).toLocaleTimeString()}</time> <b>{r.via}</b> {r.brief}</li>
        ))}
      </ul>
      <RecoveryControls engine={engine} />
      <ul className={styles.log}>
        {pending.map((a) => (
          <li key={a.id} data-tone="warn">
            {RECOVERY_OPS[a.op].label} "{a.arg}" <button type="button" onClick={() => void approve(a.id)}>Approve</button> <button type="button" onClick={() => void reject(a.id)}>Reject</button>
          </li>
        ))}
        {ops.map((o) => (
          <li key={o.id} data-tone={o.ok ? 'ok' : 'error'}><time>{new Date(o.time).toLocaleTimeString()}</time> <b>{RECOVERY_OPS[o.op].label}</b> {o.message}</li>
        ))}
        {scaffolds.map((s) => (
          <li key={s.id} data-tone="info">
            {s.name}: {s.files.map((f) => <button key={f.path} type="button" onClick={() => downloadText(f.path.replace('/', '-'), f.content, 'text/plain')}>{f.path}</button>)}
          </li>
        ))}
      </ul>
    </section>
  );
}
