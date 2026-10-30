import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { BUS_AGENTS, BUS_AGENT_IDS, inbox } from './agent-bus.js';
import { tally, type SubagentStatus } from './subagents.js';
import { CREW_ROLES, CREW_ROLE_IDS, statusCounts, type CrewStatus } from './crew.js';
import { opsAgent, type OpsAgentId } from './operations.js';
import { reporterName } from './resolution-center.js';
import { RECOVERY_OPS, RECOVERY_OP_KINDS, type RecoveryOpKind } from './recovery-ops.js';
import { downloadText } from './action-history.js';
import styles from './droid-assist.module.css';

const TONE: Record<SubagentStatus, 'ok' | 'error' | 'warn' | 'info'> = { pass: 'ok', fail: 'error', aborted: 'warn', skipped: 'info' };
const CREW_TONE: Record<CrewStatus, 'ok' | 'warn' | 'info'> = { waiting: 'info', working: 'ok', paused: 'warn' };

/** The crew: every worker by role with its status, task and last report, plus pending tests and the last intercept. */
export function CrewPanel({ engine }: { engine: AssistEngine }) {
  const { crew, lastIntercept, pendingTests, testing } = engine.crew;
  const counts = statusCounts(crew);
  return (
    <section className={styles.panel} aria-label="Crew">
      <h3>Crew <small>{crew.length} agent(s) · {counts.working} working · {counts.paused} paused · {counts.waiting} waiting{testing ? ' · testing…' : ''}</small></h3>
      {lastIntercept && <p className={styles.muted}>Last intercept from {lastIntercept.intercept.source}: "{lastIntercept.intercept.text}" → <b>{lastIntercept.proposal}</b></p>}
      {pendingTests.length > 0 && (
        <ul className={styles.log} aria-label="Pending crew tests">
          {pendingTests.map((t, i) => (
            <li key={`${t.from}-${i}`} data-tone="warn">
              Test from <b>{t.from}</b> ({t.reason}): {t.text} <button type="button" onClick={() => void engine.crew.runTest(t)} disabled={testing}>Run</button>
            </li>
          ))}
        </ul>
      )}
      {CREW_ROLE_IDS.map((role) => {
        const members = crew.filter((a) => a.role === role);
        return (
          <details key={role}>
            <summary>{CREW_ROLES[role].name} <small>{members.length} · {CREW_ROLES[role].description}</small></summary>
            <ul className={styles.log}>
              {members.map((a) => (
                <li key={a.id} data-tone={CREW_TONE[a.status]}>
                  <b>{a.id}</b> {a.status}{a.task ? ` — ${a.task}` : ''}{a.elements.length ? ` · ${a.elements.length} element(s)` : ''}
                  {a.report && <small> · {a.report}</small>}
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </section>
  );
}

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
export function AgentCrewPanel({ engine }: { engine: AssistEngine }) {
  const { crewAgents: crew, crewRunning, swarm, liveDragging, stopPlan, interveneDrag } = engine;
  const operations = engine.ops.agents;
  const opsWorking = operations.filter((agent) => agent.status === 'working').length;
  const [aimX, setAimX] = useState('50');
  const [aimY, setAimY] = useState('50');
  return (
    <section className={styles.panel} aria-label="Agent crew">
      <h3>Agent crew <small>{crewRunning ? 'running' : 'ready'} · {crew.filter((a) => a.status === 'working').length} delegated · {opsWorking}/{operations.length} operations working</small></h3>
      {crewRunning && <button type="button" onClick={stopPlan}>Stop plan</button>}
      {!crewRunning && !crew.some((a) => a.task) && <p className={styles.muted}>Try "/crew find the Save button and the Files icon" — the main AI commands the agents.</p>}
      <ul className={styles.log}>
        {crew.map((a) => (
          <li key={a.id} data-tone={a.status === 'working' ? 'info' : a.status === 'parked' ? 'warn' : 'ok'}>
            <b>{a.id}</b> {a.status}{a.task ? ` — "${a.task}"` : ''}{a.lastReport ? ` → ${a.lastReport}` : ''}
          </li>
        ))}
      </ul>
      <details open={opsWorking > 0}>
        <summary>Operations agents <small>{opsWorking} working · {operations.length - opsWorking} ready</small></summary>
        <ul className={styles.log}>
          {operations.map((agent) => (
            <li key={agent.id} data-tone={agent.status === 'working' ? 'info' : agent.status === 'parked' ? 'warn' : 'ok'}>
              <b>{opsAgent(agent.id as OpsAgentId).name}</b> {agent.status}{agent.task ? ` — ${agent.task}` : ''}{agent.lastReport ? ` → ${agent.lastReport}` : ''}
            </li>
          ))}
        </ul>
      </details>
      {swarm.length > 0 && (
        <details open={liveDragging}>
          <summary>Live drag swarm <small>{swarm.length} coordinate agents{liveDragging ? ' · dragging' : ''}</small></summary>
          {liveDragging && (
            <>
              <form className={styles.hud2} aria-label="Steer live drag" onSubmit={(event) => {
                event.preventDefault();
                const x = Number(aimX);
                const y = Number(aimY);
                if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 100 && y >= 0 && y <= 100) interveneDrag({ x: x / 100, y: y / 100 });
              }}>
                <label>Re-aim X (%) <input type="number" min="0" max="100" step="1" value={aimX} onChange={(event) => setAimX(event.target.value)} /></label>
                <label>Y (%) <input type="number" min="0" max="100" step="1" value={aimY} onChange={(event) => setAimY(event.target.value)} /></label>
                <button type="submit">Re-aim live drag</button>
                <button type="button" onClick={() => interveneDrag(null)}>Release now</button>
              </form>
              <p className={styles.muted}>One shared pointer follows the agent route; re-aiming keeps the drag active, while release safely ends it.</p>
            </>
          )}
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
