import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { frameDistance } from './drift.js';
import { checkBridge } from './bridge.js';
import { hotkeyFromEvent, sanitizeBudget } from './safety.js';
import { AiStatusBadge } from './hud.js';
import type { Habit, LogEntry } from './types.js';
import { isReliable, successRate } from './habits.js';
import type { ThinkingEntry, ThoughtKind } from './thinking-timeline.js';
import type { DeliveryStatus, EndpointStatus, ForwardedError } from './error-forwarding.js';
import { segmentLine } from './ruler.js';
import type { ElementSource, ScreenElement } from './elements.js';
import { gridRef } from './grid.js';
import { WATCH_MS_MAX, WATCH_MS_MIN } from './storage.js';
import { proposalStep, type NoteKind, type WatchProposal } from './watcher.js';
import { STAGES, unverifiedStages, type StageGroup } from './loop-control.js';
import styles from './droid-assist.module.css';

const NOTE_LABEL: Record<NoteKind, string> = { element: 'Element', change: 'Change', unusual: 'Unusual', opportunity: 'Opportunity' };
const clock = (t: number) => new Date(t).toLocaleTimeString();

/** One proposal with Accept / Dismiss (pending) and Test (when it has an on-screen target). */
function ProposalItem({ engine, p }: { engine: AssistEngine; p: WatchProposal }) {
  const pending = p.status === 'pending';
  return (
    <li data-tone={pending ? 'warn' : p.status === 'accepted' ? 'ok' : 'info'}>
      <small>{clock(p.time)}</small> {p.text} <small>· {p.status}{p.tested ? ' · tested' : ''}</small>
      {pending && <button type="button" onClick={() => engine.acceptProposal(p.id)}>Accept</button>}
      {pending && <button type="button" onClick={() => engine.dismissProposal(p.id)}>Dismiss</button>}
      {proposalStep(p) && (
        <button type="button" onClick={() => void engine.testProposal(p.id)} title={engine.armed ? 'Real click (armed, budgeted)' : 'Dry run — nothing is sent'}>Test</button>
      )}
    </li>
  );
}

/** The Screen watcher: timestamped notes, proposals with Accept / Dismiss / Test, and test results. */
export function WatcherPanel({ engine }: { engine: AssistEngine }) {
  const { notes, proposals, tests } = engine.watcher;
  const on = engine.settings.stages.screenWatcher;
  return (
    <section className={styles.panel} aria-label="Watcher">
      <h3>Watcher <small>{on ? `observing every ${(engine.settings.watchMs / 1000).toFixed(1)} s` : 'off — enable Screen watcher in Agents'}</small></h3>
      <h4>Proposals <small>{proposals.filter((p) => p.status === 'pending').length} pending</small></h4>
      <ul className={styles.log}>{proposals.map((p) => <ProposalItem key={p.id} engine={engine} p={p} />)}</ul>
      <h4>Tests <small>{tests.length}</small></h4>
      <ul className={styles.log}>
        {tests.map((t) => (
          <li key={t.id} data-tone={t.verdict === 'passed' ? 'ok' : 'error'}>
            <small>{clock(t.time)}</small> <b>{t.verdict}</b> {t.tried} — {t.happened}
          </li>
        ))}
      </ul>
      <h4>Notes <small>{notes.length}</small></h4>
      {!notes.length && <p className={styles.muted}>Notes on notable elements, changes and opportunities appear here while the watcher runs.</p>}
      <ul className={styles.log}>
        {notes.map((n) => <li key={n.id}><small>{clock(n.time)}</small> <b>{NOTE_LABEL[n.kind]}</b> {n.text}</li>)}
      </ul>
    </section>
  );
}

/** Ruler: the clicked polyline's per-segment and total distances, saved measurements, baseline and recalibration. */
export function RulerPanel({ engine }: { engine: AssistEngine }) {
  const { ruler } = engine;
  const m = ruler.measurement;
  const where = ruler.frameId === null ? 'live frame' : `frame #${ruler.frameId}`;
  return (
    <section className={styles.panel}>
      <h3>Ruler <small>{ruler.on ? `measuring the ${where}` : 'off — press 📏 Ruler'}</small></h3>
      <div className={styles.group}>
        <button type="button" onClick={ruler.undo} disabled={!ruler.points.length}>↶ Undo point</button>
        <button type="button" onClick={ruler.clear} disabled={!ruler.points.length}>Clear</button>
        <button type="button" onClick={ruler.saveRuler} disabled={!m?.segments.length}>Keep measurement</button>
        {ruler.frameId !== null && <button type="button" onClick={() => ruler.measureFrame(null)}>Back to live</button>}
        <button type="button" onClick={ruler.setBaseline}>Set baseline</button>
        <button type="button" onClick={() => ruler.recalibrateNow('manual')} disabled={!ruler.baseline}>⟲ Recalibrate</button>
      </div>
      {m && m.segments.length > 0 ? (
        <ul aria-label="Ruler segments">
          {m.segments.map((s, i) => <li key={i}>{segmentLine(s, i)}</li>)}
          <li><b>Total {m.totalPx}px ({m.totalPct}% of screen, {m.srcW}×{m.srcH})</b></li>
        </ul>
      ) : (
        <p className={styles.muted}>{ruler.points.length} point(s) — click at least two points on the screen.</p>
      )}
      <p className={styles.muted}>
        Baseline: {ruler.baseline ? `${ruler.baseline.a && ruler.baseline.b ? `"${ruler.baseline.a.name}" ↔ "${ruler.baseline.b.name}", ` : ''}grid ${Math.round(ruler.baseline.cellW)}×${Math.round(ruler.baseline.cellH)}px` : 'not set'}
        {ruler.calibration && ` · last recalibration: ${ruler.calibration.detail}${ruler.calibration.drift ? ' (rescaled)' : ''}`}
      </p>
      {ruler.measurements.length > 0 && (
        <ol aria-label="Saved measurements">
          {ruler.measurements.map((s) => <li key={s.id}><b>{s.by}</b>: {s.line}</li>)}
        </ol>
      )}
    </section>
  );
}

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
              <figcaption>#{f.id} · Δ {d.toFixed(3)} <button type="button" onClick={() => engine.ruler.measureFrame(f.id)} aria-label={`Measure frame ${f.id}`} title="Measure this frame with the ruler">📏</button></figcaption>
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
            {s.shot ? <img src={s.shot.url} alt={`After step ${i + 1}`} title="Desktop screenshot after this step ran" /> : s.refFrame ? <img src={s.refFrame.url} alt="" /> : <span className={styles.noThumb}>{s.action}</span>}
            <div>
              <input value={s.name} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label={`Step ${i + 1} name`} />
              <small>
                {s.action}{s.target ? ` "${s.target}"` : ''} @ {(s.x * 100).toFixed(0)}%,{(s.y * 100).toFixed(0)}%{s.endX !== undefined && s.endY !== undefined ? ` → ${s.endTarget ? `"${s.endTarget}" ` : ''}${(s.endX * 100).toFixed(0)}%,${(s.endY * 100).toFixed(0)}%` : ''} · {s.status}
                {s.driftPx !== undefined && ` · drift ${s.driftPx}px`}
                {s.drift !== undefined && ` · match ${s.drift.toFixed(3)}`}
              </small>
              {(s.beforeFrame || s.afterFrame) && (
                <span className={styles.evidence} aria-label={`Step ${i + 1} evidence`}>
                  {s.beforeFrame && <img src={s.beforeFrame.url} alt={`Step ${i + 1} before`} title="Before" />}
                  {s.afterFrame && <img src={s.afterFrame.url} alt={`Step ${i + 1} after`} title="After" />}
                </span>
              )}
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

/** One habit: its counts, rate, last use and lessons; unreliable ones are flagged and not auto-applied. */
function HabitItem({ habit: h, engine }: { habit: Habit; engine: AssistEngine }) {
  const reliable = isReliable(h);
  return (
    <li data-tone={reliable ? 'ok' : 'warn'}>
      <b>{h.pinned ? '📌 ' : ''}{h.target}</b>{h.context && <small> · {h.context}</small>}
      {' '}<span>{h.successes} ok / {h.attempts - h.successes} failed · {Math.round(successRate(h) * 100)}%</span>
      {!reliable && <strong> · unreliable — not auto-applied</strong>}
      <small> · last used {new Date(h.lastUsed).toLocaleString()}</small>
      <button type="button" aria-label={`${h.pinned ? 'Unpin' : 'Pin'} habit ${h.target}`} onClick={() => engine.pinHabit(h.id)}>{h.pinned ? 'Unpin' : 'Pin'}</button>
      <button type="button" aria-label={`Delete habit ${h.target}`} onClick={() => engine.deleteHabit(h.id)}>✕</button>
      {h.lessons.length > 0 && (
        <ul>
          {h.lessons.map((l) => <li key={`${l.kind}:${l.text}`}><b>{l.kind === 'avoid' ? 'Avoid' : 'Add'}</b> {l.text}</li>)}
        </ul>
      )}
    </li>
  );
}

/**
 * Habits learned from every executed step (applied to planning and grounding while reliable),
 * then the run-level lessons the planner applies to new goals.
 */
export function PatternsPanel({ engine }: { engine: AssistEngine }) {
  return (
    <section className={styles.panel}>
      <h3>Habits <small>{engine.habits.length}</small></h3>
      {!engine.habits.length && <p className={styles.muted}>Each executed step's verdict builds a habit for its target: success rate, last good position and lessons.</p>}
      <ul className={styles.log} aria-label="Habits">
        {engine.habits.map((h) => <HabitItem key={h.id} habit={h} engine={engine} />)}
      </ul>
      <h3>Learned patterns <small>{engine.patterns.length}</small></h3>
      {!engine.patterns.length && <p className={styles.muted}>After each real run the AI notes what to avoid and what to add next time.</p>}
      <ul className={styles.log}>
        {engine.patterns.map((p) => (
          <li key={p.id} data-tone={p.kind === 'avoid' ? 'warn' : 'ok'}>
            <b>{p.kind === 'avoid' ? 'Avoid' : 'Add'}</b> {p.pattern}
            {p.context && <small> · {p.context}</small>}
            <button type="button" aria-label={`Delete pattern ${p.pattern}`} onClick={() => engine.deletePattern(p.id)}>✕</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const STAGE_GROUPS: Array<{ group: StageGroup; title: string }> = [
  { group: 'pipeline', title: 'Pipeline' },
  { group: 'agent', title: 'Agents' },
];

/**
 * Loop control: one checkbox per pipeline stage and agent, with a warning while a verification
 * stage is off. Guardrails (arm, emergency stop, budget, abort) are not listed — they always apply.
 */
export function LoopControlPanel({ engine }: { engine: AssistEngine }) {
  const { settings, toggleStage } = engine;
  const unverified = unverifiedStages(settings.stages);
  return (
    <section className={styles.panel}>
      <h3>Loop control <small>guardrails always on</small></h3>
      {unverified.length > 0 && (
        <p className={styles.muted} role="alert">⚠ Unverified input: {unverified.map((s) => s.name).join(', ')} off — steps run without these checks.</p>
      )}
      {STAGE_GROUPS.map(({ group, title }) => (
        <div key={group}>
          <h4>{title}</h4>
          {STAGES.filter((s) => s.group === group).map((s) => (
            <label key={s.id} className={styles.agent}>
              <input type="checkbox" checked={settings.stages[s.id]} onChange={(e) => toggleStage(s.id, e.target.checked)} />
              <span><strong>{s.name}</strong><small>{s.description}</small></span>
            </label>
          ))}
        </div>
      ))}
    </section>
  );
}

/** Settings: gallery size, drift checkpoints, capture rate, budget, hotkey, bridge, AI endpoint. */
export function SettingsPanel({ engine }: { engine: AssistEngine }) {
  const { settings, setSettings } = engine;
  const [bridge, setBridge] = useState('');
  return (
    <section className={styles.panel}>
      <h3>Settings</h3>
      <label className={styles.setting}>Gallery frames <b>{settings.gallerySize}</b>
        <input type="range" min={4} max={30} value={settings.gallerySize} onChange={(e) => setSettings({ ...settings, gallerySize: +e.target.value })} />
      </label>
      <label className={styles.setting}>Drift checkpoints per move <b>{settings.checkpoints}</b>
        <input type="range" min={1} max={20} value={settings.checkpoints} onChange={(e) => setSettings({ ...settings, checkpoints: +e.target.value })} />
      </label>
      <label className={styles.setting}>App monitor: capture every <b>{settings.captureMs} ms</b>
        <small>Background monitor is fixed at 1000 ms, advanced at 250 ms. Active: {engine.intervalMs} ms</small>
        <input type="range" min={250} max={2000} step={50} value={settings.captureMs} onChange={(e) => setSettings({ ...settings, captureMs: +e.target.value })} />
      </label>
      <label className={styles.setting}>Screen watcher: observe every <b>{(settings.watchMs / 1000).toFixed(1)} s</b>
        <input type="range" min={WATCH_MS_MIN} max={WATCH_MS_MAX} step={500} value={settings.watchMs} onChange={(e) => setSettings({ ...settings, watchMs: +e.target.value })} />
      </label>
      <label className={styles.setting}>Screen-change threshold <b>{settings.changeCells} cells</b>
        <input type="range" min={2} max={40} value={settings.changeCells} onChange={(e) => setSettings({ ...settings, changeCells: +e.target.value })} aria-label="Screen-change threshold" />
      </label>
      <label className={styles.setting}>Max real input actions per run <b>{settings.actionBudget}</b>
        <input type="number" min={1} value={settings.actionBudget} onChange={(e) => setSettings({ ...settings, actionBudget: sanitizeBudget(e.target.valueAsNumber) })} />
      </label>
      <label className={styles.setting}>Emergency-stop hotkey <b>{settings.abortHotkey}</b>
        <input
          readOnly
          value={settings.abortHotkey}
          aria-label="Emergency-stop hotkey: focus and press a new key combo"
          onKeyDown={(e) => {
            const combo = hotkeyFromEvent(e);
            if (!combo || combo === 'Tab') return;
            e.preventDefault();
            e.stopPropagation();
            setSettings({ ...settings, abortHotkey: combo });
          }}
        />
        <small>Focus the field and press a new combo (works while this page has focus).</small>
      </label>
      <label className={styles.setting}>Desktop bridge URL (pyautogui)
        <span className={styles.row}>
          <input value={settings.bridgeUrl} onChange={(e) => setSettings({ ...settings, bridgeUrl: e.target.value })} placeholder="/bridge or http://127.0.0.1:3000" />
          <button type="button" onClick={async () => setBridge((await checkBridge(settings.bridgeUrl)).message)} disabled={!settings.bridgeUrl}>Test</button>
          <button type="button" onClick={() => void engine.connectBridge()} disabled={!settings.bridgeUrl}>Connect</button>
        </span>
        {bridge && <small>{bridge}</small>}
      </label>
      <label className={styles.setting}>AI endpoint (Ollama /api/chat)
        <input value={settings.aiUrl} onChange={(e) => setSettings({ ...settings, aiUrl: e.target.value })} aria-label="AI endpoint URL" />
      </label>
      <label className={styles.setting}>AI model
        <input value={settings.aiModel} onChange={(e) => setSettings({ ...settings, aiModel: e.target.value })} aria-label="AI model" />
      </label>
      <AiStatusBadge status={engine.aiStatus} />
      <ErrorForwardingSettings engine={engine} />
    </section>
  );
}

/** Settings → Error forwarding: endpoint, on/off, optional token and a test send. */
function ErrorForwardingSettings({ engine }: { engine: AssistEngine }) {
  const { settings, setSettings } = engine;
  return (
    <>
      <h3>Error forwarding</h3>
      <label className={styles.agent}>
        <input type="checkbox" checked={settings.errorForwarding} onChange={(e) => setSettings({ ...settings, errorForwarding: e.target.checked })} />
        <span><strong>Forward errors</strong><small>POST captured errors to the error-fix app as JSON</small></span>
      </label>
      <label className={styles.setting}>Error endpoint URL
        <input value={settings.errorUrl} onChange={(e) => setSettings({ ...settings, errorUrl: e.target.value })} placeholder="http://127.0.0.1:8787/api/errors" aria-label="Error endpoint URL" />
      </label>
      <label className={styles.setting}>Auth token (optional)
        <input type="password" value={settings.errorToken} onChange={(e) => setSettings({ ...settings, errorToken: e.target.value })} aria-label="Error endpoint auth token" autoComplete="off" />
        <small>Sent as a Bearer token; never written to the activity log.</small>
      </label>
      <button type="button" onClick={() => void engine.sendTestError()} disabled={!settings.errorUrl.trim()}>Send test error</button>
    </>
  );
}

const ENDPOINT_TONE: Record<EndpointStatus['state'], LogEntry['tone']> = { unknown: 'info', ok: 'ok', failed: 'error' };
const DELIVERY_TONE: Record<DeliveryStatus, LogEntry['tone']> = { 'not sent': 'info', sending: 'info', sent: 'ok', outbox: 'error' };

/** One forwarded error: kind, message, delivery status and a manual send (Resend from the outbox). */
function ErrorItem({ entry, onSend }: { entry: ForwardedError; onSend: () => void }) {
  const { report, status, repeats, detail } = entry;
  return (
    <li data-tone={DELIVERY_TONE[status]}>
      <time>{new Date(report.timestamp).toLocaleTimeString()}</time> <b>{report.kind}</b> {report.message}
      {report.step && <small> · step "{report.step}"</small>}
      {repeats > 0 && <small> · ×{repeats + 1}</small>}
      <small> · {status}{detail ? ` (${detail})` : ''}{report.screenshot ? ' · 📷' : ''}</small>
      <button type="button" onClick={onSend} disabled={status === 'sending'}>{status === 'outbox' ? 'Resend' : 'Send now'}</button>
    </li>
  );
}

/** Errors: everything captured for the error-fix app, with delivery status and the endpoint's last-known status. */
export function ErrorsPanel({ engine }: { engine: AssistEngine }) {
  const { errors, errorEndpoint: ep, settings } = engine;
  const outbox = errors.filter((e) => e.status === 'outbox').length;
  return (
    <section className={styles.panel} aria-label="Errors">
      <h3>Errors <small>{errors.length} captured · {outbox} in outbox · forwarding {settings.errorForwarding ? 'on' : 'off'}</small></h3>
      <p data-tone={ENDPOINT_TONE[ep.state]}>Endpoint: <b>{ep.state}</b>{ep.time ? ` at ${new Date(ep.time).toLocaleTimeString()}` : ''} — {ep.detail}</p>
      {!errors.length && <p className={styles.muted}>No errors captured.</p>}
      <ul className={styles.log}>
        {errors.map((e) => <ErrorItem key={e.report.id} entry={e} onSend={() => void engine.sendErrorNow(e.report)} />)}
      </ul>
    </section>
  );
}

/** AI help: ask the model about the live screen; shows its latest answer or the connection error. */
export function AiHelpPanel({ engine }: { engine: AssistEngine }) {
  const { aiStatus, aiAnswer, aiBusy, settings } = engine;
  const [question, setQuestion] = useState('');
  const off = aiStatus.state !== 'online' || !settings.aiHelp;
  return (
    <section className={styles.panel}>
      <h3>AI help <small>{settings.aiModel}</small></h3>
      <AiStatusBadge status={aiStatus} />
      <form
        className={styles.row}
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) void engine.askScreen(question.trim());
        }}
      >
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about the screen…" aria-label="Ask the AI" />
        <button type="submit" disabled={off || aiBusy || !question.trim()}>{aiBusy ? '…' : 'Ask'}</button>
      </form>
      {aiStatus.state === 'offline' && <p className={styles.muted} role="alert">{aiStatus.detail}. AI plan, Auto act and AI help are unavailable.</p>}
      {aiAnswer && <p>{aiAnswer}</p>}
    </section>
  );
}

/** Persistent history of every executed mouse/keyboard action, with JSON/CSV export. */
export function ActionHistoryPanel({ engine }: { engine: AssistEngine }) {
  const { history } = engine;
  return (
    <section className={styles.panel}>
      <h3>Action history <small>{history.length} action(s)</small></h3>
      <div className={styles.row}>
        <button type="button" onClick={() => engine.exportHistory('json')} disabled={!history.length}>Export JSON</button>
        <button type="button" onClick={() => engine.exportHistory('csv')} disabled={!history.length}>Export CSV</button>
        <button type="button" onClick={engine.resetHistory} disabled={!history.length}>Clear</button>
      </div>
      <ul className={styles.log}>
        {history.slice(0, 200).map((a) => (
          <li key={a.id} data-tone={a.ok ? 'ok' : 'error'}>
            <time>{new Date(a.time).toLocaleTimeString()}</time> <b>{a.source}</b> {a.action} ({a.x}, {a.y}){a.endX !== undefined ? ` → (${a.endX}, ${a.endY})` : ''}{a.text ? ` "${a.text}"` : ''} · {a.via}
          </li>
        ))}
      </ul>
    </section>
  );
}

const SOURCE_LABEL: Record<ElementSource, string> = { template: 'Template match', popup: 'Popup detected', familiar: 'Familiar' };

/** One listed element: name, source, grid cell + coordinates, its patch and the Test click button. */
function ElementItem({ engine, el }: { engine: AssistEngine; el: ScreenElement }) {
  return (
    <li data-tone={el.source === 'popup' ? 'warn' : 'info'}>
      {el.patch && <img src={el.patch} alt={`${el.name} patch`} width={32} height={32} />}
      <b>{el.name}</b> <small>{SOURCE_LABEL[el.source]}</small> · {gridRef(el)} = ({(el.x * 100).toFixed(1)}%, {(el.y * 100).toFixed(1)}%)
      {el.lastSeen !== undefined && <small> · seen {new Date(el.lastSeen).toLocaleTimeString()}</small>}
      <button type="button" onClick={() => void engine.testClick(el)} title={engine.armed ? 'Clicks this point on the PC (real input, budgeted)' : 'Highlights this point only (disarmed dry run)'}>
        Test click
      </button>
      {el.source === 'familiar' && <button type="button" aria-label={`Forget ${el.name}`} onClick={() => engine.forgetFamiliar(el.id)}>✕</button>}
    </li>
  );
}

/** On-screen elements found by template matching and popup detection, plus the familiar-elements memory. */
export function ElementsPanel({ engine }: { engine: AssistEngine }) {
  const { elements, armed } = engine;
  return (
    <section className={styles.panel} aria-label="Elements">
      <h3>Elements <small>{elements.length} · Test click {armed ? 'sends real input' : 'is highlight-only (disarmed)'}</small></h3>
      {!elements.length && <p className={styles.muted}>Verified or used targets are remembered here with their grid cell and coordinates.</p>}
      <ul className={styles.log}>
        {elements.map((el) => <ElementItem key={el.id} engine={engine} el={el} />)}
      </ul>
    </section>
  );
}

const KIND_LABEL: Record<ThoughtKind, string> = { thought: '💭 Thought', change: '🖥️ Screen change', proposal: '🎯 Proposal', reflection: '🔁 Reflection', verdict: '⚖️ Verdict' };

/** Tone of an entry: failures as errors, verdicts by their outcome, unready proposals as warnings, the rest informational. */
function entryTone(e: ThinkingEntry): LogEntry['tone'] {
  if (e.error) return 'error';
  if (e.kind === 'proposal') return e.text.includes('NOT READY') ? 'warn' : 'info';
  if (e.kind !== 'verdict') return 'info';
  return e.text.startsWith('SUCCESS') ? 'ok' : 'warn';
}

/** One timeline entry: what the model answered and the thinking it returned — or plainly that there was none. */
function ThinkingItem({ entry }: { entry: ThinkingEntry }) {
  return (
    <li data-tone={entryTone(entry)}>
      <time>{new Date(entry.time).toLocaleTimeString()}</time> <b>{entry.step}</b> · {KIND_LABEL[entry.kind]}
      {entry.error ? (
        <p role="alert">AI call failed — {entry.error}</p>
      ) : (
        <>
          <p>{entry.text}</p>
          {entry.thinking ? <pre className={styles.muted}>{entry.thinking}</pre> : <p className={styles.muted}>No thinking returned by the model</p>}
        </>
      )}
    </li>
  );
}

/** Qwen thinking: per-step timeline of the model's thought, follow-up reflection and final verdict. */
export function QwenThinkingPanel({ engine }: { engine: AssistEngine }) {
  const { timeline, aiStatus, settings } = engine;
  return (
    <section className={styles.panel} aria-label="Qwen thinking">
      <h3>Qwen thinking <small>{settings.aiModel}</small></h3>
      {aiStatus.state === 'offline' && <p className={styles.muted} role="alert">{aiStatus.detail}</p>}
      {!timeline.length && <p className={styles.muted}>No AI calls yet.</p>}
      <ul className={styles.log}>
        {timeline.map((e) => <ThinkingItem key={e.id} entry={e} />)}
      </ul>
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
