import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { frameDistance } from './drift.js';
import { checkBridge } from './bridge.js';
import { hotkeyFromEvent, sanitizeBudget } from './safety.js';
import { AiStatusBadge, InsecureBridgeWarning } from './hud.js';
import { ModelPicker } from './model-picker.js';
import type { FamiliarElement, Frame, Habit, LogEntry } from './types.js';
import type { Box } from './assist-ai.js';
import type { Briefing } from './briefing.js';
import { OBJECTIVE_TONE, type ChainRun } from './chain.js';
import { snipText, type Snip } from './snip.js';
import { DisplayPicker } from './display-picker.js';
import { BridgeWizard } from './bridge-wizard.js';
import { isReliable, successRate } from './habits.js';
import type { ThinkingEntry, ThoughtKind } from './thinking-timeline.js';
import type { StepFix } from './supervisor.js';
import type { DeliveryStatus, EndpointStatus, ForwardedError } from './error-forwarding.js';
import { segmentLine } from './ruler.js';
import type { ElementSource, ScreenElement } from './elements.js';
import { gridRef } from './grid.js';
import { MAP_COLS, MAP_ROWS, boxCenter, mapCells, type MappedElement, type PerformFn, type PerformKind } from './element-map-studio.js';
import { countHere, ghostPositions, motionOf, motionTiming, type MotionKind } from './element-tracking.js';
import { PERFORM_KINDS, checkPerform, performText } from './element-perform.js';
import { TRAIN_MODES, type TrainMode, type TrainingReport } from './element-training.js';
import { WATCH_MS_MAX, WATCH_MS_MIN } from './storage.js';
import { proposalStep, recallNotes, type NoteKind, type WatchProposal } from './watcher.js';
import { WAKE_MS_MAX, WAKE_MS_MIN } from './wake.js';
import { contextText } from './context-workflow.js';
import { MAP_COLS, MAP_ROWS, boxCenter, mapCells } from './element-map-studio.js';
import { GOAL_STALL_MAX, GOAL_STALL_MIN, WATCH_MS_MAX, WATCH_MS_MIN } from './storage.js';
import { proposalStep, type NoteKind, type WatchProposal } from './watcher.js';
import { STAGES, unverifiedStages, type StageGroup } from './loop-control.js';
import { AI_TIMEOUT_MS_MAX, AI_TIMEOUT_MS_MIN, AI_VIEWS, MASTER_PROMPT_MAX, type AiView } from './ai.js';
import { HISTORY_MAX, STALE_KEEP, estimateTokens, historyStats } from './ai-history.js';
import { STEP_RETRIES_MAX, STEP_RETRIES_MIN } from './retry-ladder.js';
import { AI_MAX_IN_FLIGHT_MAX, AI_MAX_IN_FLIGHT_MIN } from './ai-queue.js';
import { CREW_SIZE_MAX, CREW_SIZE_MIN, clampCrewSize } from './crew.js';
import { BackupSettings } from './backup-panel.js';
import { FixScriptReview } from './screen-ai-panels.js';
import { sectionMemoryLines } from './sections.js';
import { replicaLine } from './replicate.js';
import { SIDE_TEST_MODES, feedbackLine, type SideTestMode } from './side-test.js';
import { RecoverySettings, RelaxSettings } from './relax-recovery-settings.js';
import styles from './droid-assist.module.css';

const NOTE_LABEL: Record<NoteKind, string> = { element: 'Element', change: 'Change', unusual: 'Unusual', opportunity: 'Opportunity', wake: 'Wake', decision: 'Decision', error: 'Error' };
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

/** Wake and continue: the running wait, parallel context workflows, and this operation's notes grouped by kind. */
export function WakePanel({ engine }: { engine: AssistEngine }) {
  const { wait, contexts, endContext } = engine.wake;
  const op = engine.goal.trim();
  const opNotes = op ? recallNotes(engine.watcher.notes, { op }) : [];
  const errors = recallNotes(engine.watcher.notes, { kind: 'error' });
  return (
    <section className={styles.panel} aria-label="Wake and continue">
      <h3>Wake and continue <small>{engine.settings.stages.wake ? `wakes after ${(engine.settings.wakeMs / 1000).toFixed(0)} s` : 'off — enable Wake and continue in Loop control'}</small></h3>
      {wait ? (
        <p>Waiting before <b>{wait.step}</b> on: {wait.waitingOn} <small>· since {clock(wait.since)} · wakes in {Math.round(wait.delay / 1000)} s</small></p>
      ) : (
        <p className={styles.muted}>Not waiting.</p>
      )}
      <h4>Parallel workflows <small>{contexts.filter((c) => c.running).length} running</small></h4>
      <ul className={styles.log}>
        {contexts.map((c) => (
          <li key={c.id} data-tone={c.running ? 'ok' : 'info'}>
            <small>{clock(c.time)} · {c.by}</small> {contextText(c)}
            {c.running && <button type="button" onClick={() => endContext(c.id, 'user')}>Stop</button>}
          </li>
        ))}
      </ul>
      <h4>This operation <small>{opNotes.length} note(s)</small></h4>
      <ul className={styles.log}>{opNotes.map((n) => <li key={n.id}><small>{clock(n.time)} · {n.source ?? 'Screen watcher'}</small> <b>{NOTE_LABEL[n.kind]}</b> {n.text}</li>)}</ul>
      <h4>Errors <small>{errors.length}</small></h4>
      <ul className={styles.log}>{errors.map((n) => <li key={n.id} data-tone="error"><small>{clock(n.time)} · {n.source ?? ''}{n.op ? ` · ${n.op}` : ''}</small> {n.text}</li>)}</ul>
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
        <button type="button" onClick={() => void engine.invoke('ruler.recalibrate')} disabled={!ruler.baseline}>⟲ Recalibrate</button>
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
            <figure key={f.id} id={`frame-${f.id}`} className={d > 0.04 ? styles.changed : ''}>
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
              <figure key={f.id} id={`pinned-frame-${f.id}`} className={styles.pinned}>
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
              <input value={s.name} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} onFocus={(e) => { e.currentTarget.dataset.was = e.currentTarget.value; }} onBlur={(e) => { const name = e.currentTarget.value.trim(); if (name !== (e.currentTarget.dataset.was ?? '').trim()) engine.knowledge.noteSignal('correction', `renamed step to "${name}"`); }} aria-label={`Step ${i + 1} name`} />
              <small>
                {s.action}{s.target ? ` "${s.target}"` : ''}{(s.action === 'key' || s.action === 'scroll') && s.text ? ` ${s.text}` : ''} @ {(s.x * 100).toFixed(0)}%,{(s.y * 100).toFixed(0)}%{s.endX !== undefined && s.endY !== undefined ? ` → ${s.endTarget ? `"${s.endTarget}" ` : ''}${(s.endX * 100).toFixed(0)}%,${(s.endY * 100).toFixed(0)}%` : ''} · {s.status}
                {s.delayMs !== undefined && ` · after ${s.delayMs}ms`}
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
            <button type="button" aria-label="Remove step" onClick={() => engine.removeStep(i)}>✕</button>
          </li>
        ))}
      </ol>
      {draftCard && (
        <div className={styles.card}>
          <input value={draftCard.name} onChange={(e) => setDraftCard({ ...draftCard, name: e.target.value })} aria-label="Workflow name" />
          <textarea value={draftCard.description} onChange={(e) => setDraftCard({ ...draftCard, description: e.target.value })} aria-label="Workflow description" />
          <button type="button" className={styles.primary} onClick={() => void engine.invoke('workflow.save')}>💾 Save</button>
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
          <button type="button" key={c.id} className={styles.savedCard} onClick={() => void engine.invoke('workflow.load', { name: c.id })}>
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

/**
 * Capabilities: every registered feature (the single dispatch surface for buttons, the AI, agents
 * and the main app) and the invocation log — requester, parameters and result.
 */
export function CapabilitiesPanel({ engine }: { engine: AssistEngine }) {
  const { capabilities, invocations } = engine;
  return (
    <section className={styles.panel} aria-label="Capabilities">
      <h3>Capabilities <small>{capabilities.length} registered · {invocations.length} invocation(s)</small></h3>
      <ul className={styles.log} aria-label="Capability invocations">
        {invocations.map((r, i) => (
          <li key={`${r.time}-${i}`} data-tone={r.ok ? 'ok' : 'error'}>
            <small>{clock(r.time)}</small> <b>{r.requester}</b> → {r.id} <small>{JSON.stringify(r.params)}</small>: {r.result}
          </li>
        ))}
      </ul>
      <details>
        <summary>Registered capabilities</summary>
        <ul>{capabilities.map((c) => <li key={c.id}><b>{c.id}</b> <small>{c.description}</small></li>)}</ul>
      </details>
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
  const { settings } = engine;
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
              <input type="checkbox" checked={settings.stages[s.id]} onChange={(e) => void engine.invoke(`stage.${s.id}`, { on: e.target.checked })} />
              <span><strong>{s.name}</strong><small>{s.description}</small></span>
            </label>
          ))}
        </div>
      ))}
    </section>
  );
}

/**
 * The background agents the user can toggle. Each also has an inbox on the inter-agent bus
 * (see the Agent bus panel), so a discovered element can be forwarded between them.
 */
export function AgentsPanel({ engine }: { engine: AssistEngine }) {
  const { agents } = engine;
  return (
    <section className={styles.panel}>
      <h3>Agents</h3>
      {agents.map((a) => (
        <label key={a.id} className={styles.agent}>
          <input type="checkbox" checked={a.on} onChange={(e) => void engine.invoke(`agent.${a.id}`, { on: e.target.checked })} />
          <span><strong>{a.name}</strong><small>{a.description}</small></span>
          <input type="checkbox" checked={a.on} onChange={(e) => setAgents(agents.map((x) => (x.id === a.id ? { ...x, on: e.target.checked } : x)))} />
          <span><strong>{a.name}</strong><small>{a.description}</small>{a.id === 'goalTracer' && <small aria-label="Goal tracer status">Live: {engine.tracerStatus}</small>}</span>
        </label>
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
      {window.droidNative && (
        <div className={styles.setting}>Capture display
          <small>Native capture screenshots this display; input is sent to it. Falls back to the primary when it is unplugged.</small>
          <DisplayPicker engine={engine} />
        </div>
      )}
      <label className={styles.setting}>Gallery frames <b>{settings.gallerySize}</b>
        <input type="range" min={4} max={30} value={settings.gallerySize} onChange={(e) => setSettings({ ...settings, gallerySize: +e.target.value })} />
      </label>
      <label className={styles.setting}>Drift checkpoints per move <b>{settings.checkpoints}</b>
        <input type="range" min={1} max={20} value={settings.checkpoints} onChange={(e) => setSettings({ ...settings, checkpoints: +e.target.value })} />
      </label>
      <label className={styles.setting}>App monitor: capture every <b>{settings.captureMs} ms</b>
        <small>Background monitor is fixed at 1000 ms, advanced at 250 ms. Active: {engine.intervalMs} ms</small>
        <input type="range" min={250} max={2000} step={50} value={settings.captureMs} onChange={(e) => void engine.invoke('setting.captureMs', { value: +e.target.value })} />
      </label>
      <label className={styles.setting}>Screen watcher: observe every <b>{(settings.watchMs / 1000).toFixed(1)} s</b>
        <input type="range" min={WATCH_MS_MIN} max={WATCH_MS_MAX} step={500} value={settings.watchMs} onChange={(e) => void engine.invoke('setting.watchMs', { value: +e.target.value })} />
      </label>
      <label className={styles.setting}>Wake timer: wake the AI after waiting <b>{(settings.wakeMs / 1000).toFixed(0)} s</b>
        <small>The AI may ask for a longer wait when it estimates one; the backup watcher can wake it earlier.</small>
        <input type="range" min={WAKE_MS_MIN} max={WAKE_MS_MAX} step={5000} value={settings.wakeMs} onChange={(e) => setSettings({ ...settings, wakeMs: +e.target.value })} aria-label="Wake timer" />
      </label>
      <label className={styles.setting}>Screen-change threshold <b>{settings.changeCells} cells</b>
        <input type="range" min={2} max={40} value={settings.changeCells} onChange={(e) => setSettings({ ...settings, changeCells: +e.target.value })} aria-label="Screen-change threshold" />
      </label>
      <label className={styles.setting}>Goal tracer: stalled after <b>{settings.goalStall} setback(s)</b>
        <small>Failed steps or goal checks without progress in a row before the tracer reports a stall.</small>
        <input type="range" min={GOAL_STALL_MIN} max={GOAL_STALL_MAX} value={settings.goalStall} onChange={(e) => setSettings({ ...settings, goalStall: +e.target.value })} aria-label="Goal tracer stall threshold" />
      </label>
      <label className={styles.setting}>Retries per failed step <b>{settings.stepRetries}</b>
        <small>Each retry re-verifies and re-corrects the target and spends budget; then the planner re-plans the step once.</small>
        <input type="range" min={STEP_RETRIES_MIN} max={STEP_RETRIES_MAX} value={settings.stepRetries} onChange={(e) => void engine.invoke('setting.stepRetries', { value: +e.target.value })} aria-label="Retries per failed step" />
      </label>
      <label className={styles.setting}>Crew size <b>{settings.crewSize} agents</b>
        <small>Worker agents the main AI assigns to coordinate sentinels, path checkers, adjusters, test runners and monitors.</small>
        <input type="range" min={CREW_SIZE_MIN} max={CREW_SIZE_MAX} value={settings.crewSize} onChange={(e) => setSettings({ ...settings, crewSize: clampCrewSize(+e.target.value) })} aria-label="Crew size" />
      </label>
      <label className={styles.setting}>Max real input actions per run <b>{settings.actionBudget}</b>
        <input type="number" min={1} value={settings.actionBudget} onChange={(e) => void engine.invoke('guard.budget', { limit: sanitizeBudget(e.target.valueAsNumber) })} />
      </label>
      <label className={styles.setting}>Max AI calls in flight <b>{settings.aiMaxInFlight}</b>
        <small>Further calls wait in a shared queue: executor/grounding first, planner/verdict next, background agents last.</small>
        <input type="range" min={AI_MAX_IN_FLIGHT_MIN} max={AI_MAX_IN_FLIGHT_MAX} value={settings.aiMaxInFlight} onChange={(e) => setSettings({ ...settings, aiMaxInFlight: +e.target.value })} aria-label="Max AI calls in flight" />
      </label>
      <label className={styles.setting}>AI request timeout <b>{settings.aiTimeoutMs / 1000} s</b>
        <small>A model call with no reply by then fails; queued calls start their clock when they leave the queue. Stop still cancels at once.</small>
        <input type="range" min={AI_TIMEOUT_MS_MIN} max={AI_TIMEOUT_MS_MAX} step={5000} value={settings.aiTimeoutMs} onChange={(e) => setSettings({ ...settings, aiTimeoutMs: +e.target.value })} aria-label="AI request timeout" />
      </label>
      <label className={styles.setting}>
        <span><input type="checkbox" checked={settings.aiOverlap} onChange={(e) => setSettings({ ...settings, aiOverlap: e.target.checked })} aria-label="AI overlap mode" /> AI overlap mode</span>
        <small>Each AI ask also fires a second, freshly worded call through the same queue; the first valid answer wins and the other is cancelled.</small>
      </label>
      <label className={styles.setting}>Master Prompt Override
        <small>Steers every goal, task, operation and workflow — preferred methods, tone, mood. Added to every AI prompt; leave empty for none.</small>
        <textarea value={settings.masterPrompt} maxLength={MASTER_PROMPT_MAX} onChange={(e) => setSettings({ ...settings, masterPrompt: e.target.value.slice(0, MASTER_PROMPT_MAX) })} aria-label="Master Prompt Override" placeholder="e.g. Prefer keyboard shortcuts, be cautious, keep a calm tone" />
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
          <button type="button" onClick={async () => setBridge((await checkBridge(settings.bridgeUrl, settings.bridgeToken)).message)} disabled={!settings.bridgeUrl}>Test</button>
          <button type="button" onClick={() => void engine.connectBridge()} disabled={!settings.bridgeUrl}>Connect</button>
        </span>
        {bridge && <small>{bridge}</small>}
      </label>
      <InsecureBridgeWarning bridgeUrl={settings.bridgeUrl} />
      <BridgeWizard
        bridgeUrl={settings.bridgeUrl}
        token={settings.bridgeToken}
        onFill={(bridgeUrl, bridgeToken) => setSettings({ ...settings, bridgeUrl, bridgeToken })}
        onConnect={(url, token) => engine.connectBridge({ url, token })}
      />
      <label className={styles.setting}>Bridge auth token
        <input type="password" value={settings.bridgeToken} onChange={(e) => setSettings({ ...settings, bridgeToken: e.target.value })} aria-label="Bridge auth token" autoComplete="off" />
        <small>Must match DROID_BRIDGE_TOKEN on the bridge; sent as a Bearer token on every bridge call and never written to the activity log.</small>
      </label>
      <label className={styles.setting}>AI endpoint (Ollama /api/chat)
        <input value={settings.aiUrl} onChange={(e) => setSettings({ ...settings, aiUrl: e.target.value })} aria-label="AI endpoint URL" />
      </label>
      <label className={styles.setting}>AI view resolution
        <select value={settings.aiView} onChange={(e) => void engine.invoke('setting.aiView', { value: e.target.value })} aria-label="AI view resolution">
          {Object.keys(AI_VIEWS).map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <small>Size of the screenshot the model sees; replies are scaled back to the 480x270 sample space.</small>
      </label>
      <label className={styles.setting}>Side tests run in
        <select value={settings.sideTestMode} onChange={(e) => setSettings({ ...settings, sideTestMode: e.target.value as SideTestMode })} aria-label="Side test mode">
          {SIDE_TEST_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <small>Background keeps the main capture and acts via the bridge; foreground switches to the side window first.</small>
      </label>
      <ModelPicker url={settings.aiUrl} model={settings.aiModel} onSelect={(aiModel) => setSettings({ ...settings, aiModel })} />
      <span className={styles.row}>
        <button type="button" onClick={() => void engine.connectAi()} disabled={engine.aiStatus.state === 'checking' || !settings.aiUrl} aria-label="Connect AI">Connect</button>
        <AiStatusBadge status={engine.aiStatus} />
      </span>
      <ErrorForwardingSettings engine={engine} />
      <BackupSettings onExport={() => void engine.invoke('backup.export')} />
      <RelaxSettings engine={engine} />
      <BackupSettings />
      <RecoverySettings engine={engine} />
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

/** The AI session's conversation history: roles, sizes, times, a token estimate, trim-to-N and reset. */
export function AiHistoryPanel({ engine }: { engine: AssistEngine }) {
  const { aiHistory } = engine;
  const [keep, setKeep] = useState(STALE_KEEP);
  const stats = historyStats(aiHistory);
  return (
    <section className={styles.panel}>
      <h3>AI conversation <small>{stats.messages}/{HISTORY_MAX} message(s) · {stats.chars} chars · ~{stats.tokens} tokens</small></h3>
      <div className={styles.row}>
        <label>
          Keep last <input type="number" min={0} max={HISTORY_MAX} value={keep} onChange={(e) => setKeep(Number(e.target.value))} aria-label="Messages to keep" />
        </label>
        <button type="button" onClick={() => engine.trimAiHistory(keep)} disabled={aiHistory.length <= keep}>Trim</button>
        <button type="button" onClick={engine.resetAiSession}>Reset session</button>
      </div>
      <ul className={styles.log}>
        {aiHistory.map((m, i) => (
          <li key={i} data-tone={m.role === 'assistant' ? 'ok' : 'info'}>
            <time>{m.time ? new Date(m.time).toLocaleTimeString() : '—'}</time> <b>{m.role}</b> {m.content.length} chars · ~{estimateTokens(m.content)} tokens
          </li>
        ))}
      </ul>
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
        <button type="button" onClick={() => void engine.invoke('history.export', { format: 'json' })} disabled={!history.length}>Export JSON</button>
        <button type="button" onClick={() => void engine.invoke('history.export', { format: 'csv' })} disabled={!history.length}>Export CSV</button>
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
      <button type="button" onClick={() => void engine.invoke('test.element', { name: el.name, x: el.x, y: el.y })} title={engine.armed ? 'Clicks this point on the PC (real input, budgeted)' : 'Highlights this point only (disarmed dry run)'}>
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

/** Element map studio: toggle the map mode, name the drawn box, list and delete mapped elements. */
export function ElementMapPanel({ engine }: { engine: AssistEngine }) {
  const { elementMap, mapMode, mapDraft, settings, setSettings } = engine;
  const [name, setName] = useState('');
  return (
    <section className={styles.panel} aria-label="Element map">
      <h3>Element map <small>{elementMap.length} mapped · own {MAP_ROWS}x{MAP_COLS} grid</small></h3>
      <button type="button" aria-pressed={mapMode} onClick={() => void engine.invoke('map.toggle')}>{mapMode ? 'Done mapping' : 'Map elements'}</button>
      <button type="button" aria-pressed={mapMode} onClick={engine.toggleMapMode}>{mapMode ? 'Done mapping' : 'Map elements'}</button>
      <button type="button" onClick={() => engine.scanNow()}>Scan now</button>
      <label>
        <input type="checkbox" checked={settings.autoScan} onChange={(e) => setSettings({ ...settings, autoScan: e.target.checked })} /> Auto-scan every frame
      </label>
      <label>
        Training{' '}
        <select value={settings.trainMode} onChange={(e) => setSettings({ ...settings, trainMode: e.target.value as TrainMode })} aria-label="Training mode">
          {TRAIN_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      {mapMode && !mapDraft && <p className={styles.muted}>Click-drag on the live screen to draw an element's boundary.</p>}
      {mapDraft && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void engine.saveMapped(name);
            setName('');
          }}
        >
          <small>Box {mapCells(mapDraft)} · {(mapDraft.w * 100).toFixed(1)}% x {(mapDraft.h * 100).toFixed(1)}%</small>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Element name" aria-label="Element name" />
          <button type="submit" disabled={!name.trim()}>Save element</button>
        </form>
      )}
      <ul className={styles.log}>
        {elementMap.map((el) => <MappedItem key={el.id} engine={engine} el={el} />)}
      </ul>
      {engine.training && <TrainingReportView report={engine.training} />}
    </section>
  );
}

const MOTION_LABEL: Record<MotionKind, string> = { static: 'static', moved: 'moved', in_motion: 'always in motion' };

/** Where an element is and was: motion label with move counts, ghost positions with counts, and observed timing. */
function TrackingInfo({ el }: { el: MappedElement }) {
  const motion = motionOf(el);
  const timing = motionTiming(el);
  const ghosts = ghostPositions(el);
  return (
    <small>
      {' '}· {el.origin === 'auto' ? `auto ${el.kind ?? ''}` : 'drawn'} · <b>{MOTION_LABEL[motion.kind]}</b>
      {motion.kind !== 'static' && ` (user ${motion.user}, AI ${motion.ai}, self ${motion.self})`}
      {el.timesSeen !== undefined && ` · seen ${el.timesSeen}× (${countHere(el)}× here)`}
      {ghosts.length > 0 && ` · was at ${ghosts.map((g) => `${mapCells(g.box)} ${g.count}×`).join(', ')}`}
      {timing && ` · moves every ~${Math.round(timing.meanMs)} ms ±${Math.round(timing.jitterMs)} (intervals ${timing.intervals.map((i) => Math.round(i)).join('/')}) · next move ~${new Date(timing.nextAt).toLocaleTimeString()}`}
    </small>
  );
}

/** The user's perform editor: kind, text for type, drop element for drag. */
function PerformEditor({ engine, el }: { engine: AssistEngine; el: MappedElement }) {
  const [kind, setKind] = useState<PerformKind>(el.perform?.kind ?? 'click');
  const [text, setText] = useState(el.perform?.text ?? '');
  const [drop, setDrop] = useState(el.perform?.toElementId ?? '');
  const others = engine.elementMap.filter((o) => o.id !== el.id);
  const draft: PerformFn = { kind, source: 'user', ...(kind === 'type' ? { text } : {}), ...(kind === 'drag' && drop ? { toElementId: drop } : {}) };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        engine.setElementPerform(el.id, draft);
      }}
    >
      <select value={kind} onChange={(e) => setKind(e.target.value as PerformKind)} aria-label={`Perform of ${el.name}`}>
        {PERFORM_KINDS.map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
      </select>
      {kind === 'type' && <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Text to type" aria-label={`Text for ${el.name}`} />}
      {kind === 'drag' && (
        <select value={drop} onChange={(e) => setDrop(e.target.value)} aria-label={`Drop target of ${el.name}`}>
          <option value="">Drop on…</option>
          {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
      <button type="submit" disabled={!checkPerform(draft).ok}>Set perform</button>
    </form>
  );
}

/** One mapped element: tracking info, its perform, and the perform / workflow / training actions. */
function MappedItem({ engine, el }: { engine: AssistEngine; el: MappedElement }) {
  return (
    <li data-tone={motionOf(el).kind === 'in_motion' ? 'warn' : 'info'}>
      <b>{el.name}</b> · {mapCells(el.box)} · center {gridRef(boxCenter(el.box))}
      <TrackingInfo el={el} />
      {el.perform && <small> · performs {performText(el.perform, engine.elementMap)} ({el.perform.source === 'ai' ? 'AI' : 'you'})</small>}
      <PerformEditor engine={engine} el={el} />
      <button type="button" onClick={() => void engine.proposePerform(el.id)}>Ask AI</button>
      <button type="button" disabled={!el.perform} onClick={() => engine.addNavigateStep(el.id)}>Add to workflow</button>
      <button type="button" onClick={() => void engine.trainMapped(el.id)}>Train</button>
      <button type="button" aria-label={`Delete ${el.name}`} onClick={() => engine.deleteMapped(el.id)}>✕</button>
    </li>
  );
}

/** The latest training session: status, each action with its screenshot, related elements and research. */
function TrainingReportView({ report }: { report: TrainingReport }) {
  return (
    <div aria-label="Training report">
      <h4>Training "{report.name}" <small>{report.mode} · {report.status} · {report.related.length} related</small></h4>
      <ul className={styles.log}>
        {report.entries.map((e, i) => (
          <li key={i} data-tone={e.ok ? 'ok' : 'error'}>
            {e.shot && <img src={e.shot.url} alt={`${e.label} screenshot`} width={96} />}
            <b>{e.label}</b> — {e.message}
          </li>
        ))}
      </ul>
      {report.research && <p>{report.research}</p>}
    </div>
  );
}

/** One learned target: grid cell, current coordinates, times seen, last update and Test click. */
function LearnedItem({ engine, el }: { engine: AssistEngine; el: FamiliarElement }) {
  return (
    <li data-tone="info">
      <b>{el.name}</b> · {gridRef(el)} = ({(el.x * 100).toFixed(1)}%, {(el.y * 100).toFixed(1)}%)
      <small> · seen {el.timesSeen ?? 0}× · updated {new Date(el.lastSeen).toLocaleTimeString()}{el.frameId !== undefined ? ` on frame #${el.frameId}` : ''}</small>
      <button type="button" onClick={() => void engine.invoke('test.element', { name: el.name, x: el.x, y: el.y })} title={engine.armed ? 'Clicks this point on the PC (real input, budgeted)' : 'Highlights this point only (disarmed dry run)'}>
        Test click
      </button>
    </li>
  );
}

/** Targets the coordinate learner learned from cursor dwell and verified actions, with their current coordinates. */
export function LearnedCoordsPanel({ engine }: { engine: AssistEngine }) {
  const { learned, agents } = engine;
  const on = agents.find((a) => a.id === 'coords')?.on ?? false;
  return (
    <section className={styles.panel} aria-label="Learned coordinates">
      <h3>Learned coordinates <small>{learned.length} target(s) · learner {on ? 'on' : 'off'}</small></h3>
      {!learned.length && <p className={styles.muted}>Rest the cursor on a known target or run a pointer step; its coordinates are learned and re-learned when it moves.</p>}
      <ul className={styles.log}>
        {learned.map((el) => <LearnedItem key={el.id} engine={engine} el={el} />)}
      </ul>
    </section>
  );
}

const KIND_LABEL: Record<ThoughtKind, string> = { thought: '💭 Thought', change: '🖥️ Screen change', proposal: '🎯 Proposal', reflection: '🔁 Reflection', verdict: '⚖️ Verdict', check: '🔎 Check', review: '🧭 Supervisor review', movement: '🖱️ Supervisor movement', attempt: '🔄 Attempt', snip: '✂️ Snip' };

/** Tone of an entry: failures as errors, verdicts and checks by their outcome, unready proposals as warnings, the rest informational. */
function entryTone(e: ThinkingEntry): LogEntry['tone'] {
  if (e.error) return 'error';
  if (e.kind === 'proposal') return e.text.includes('NOT READY') ? 'warn' : 'info';
  if (e.kind === 'attempt') return /— OK:/.test(e.text) ? 'ok' : 'warn';
  if (e.kind !== 'verdict' && e.kind !== 'check') return 'info';
  return /^(SUCCESS|PASS)/.test(e.text) ? 'ok' : 'warn';
}

/** One timeline entry: what the model answered and the thinking it returned — or plainly that there was none. */
function ThinkingItem({ entry }: { entry: ThinkingEntry }) {
  return (
    <li id={`think-${entry.id}`} data-tone={entryTone(entry)}>
      <time>{new Date(entry.time).toLocaleTimeString()}</time> <b>{entry.step}</b> · {KIND_LABEL[entry.kind]}
      {entry.error ? (
        <p role="alert">AI call failed — {entry.error}</p>
      ) : (
        <>
          <p>{entry.text}</p>
          {entry.frame && <img src={entry.frame.url} alt={`Snip for ${entry.step}`} style={{ maxWidth: '100%' }} />}
          {entry.thinking ? <pre className={styles.muted}>{entry.thinking}</pre> : <p className={styles.muted}>No thinking returned by the model</p>}
        </>
      )}
    </li>
  );
}

/** A frame with the given normalised boxes drawn over it in red. */
function BoxedFrame({ frame, boxes, label }: { frame: Frame; boxes: Box[]; label: string }) {
  return (
    <figure>
      <div style={{ position: 'relative' }}>
        <img src={frame.url} alt={label} style={{ display: 'block', width: '100%' }} />
        {boxes.map((b, i) => (
          <span key={i} style={{ position: 'absolute', left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, border: '2px solid red', boxSizing: 'border-box' }} />
        ))}
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

/** The live frame beside the reference frame (changed regions boxed) and zoomed crops of the planned point. */
function BriefingComparison({ b }: { b: Briefing }) {
  const c = b.comparison;
  return (
    <>
      <h4>Screenshot comparison {b.aiNote && <small>local pixel check</small>}</h4>
      <div className={styles.gallery}>
        {c.live && <BoxedFrame frame={c.live} boxes={c.regions} label={`Live #${c.live.id}`} />}
        {c.reference && <BoxedFrame frame={c.reference} boxes={c.regions} label={`Reference: ${c.referenceLabel}`} />}
        {b.liveCrop && <figure><img src={b.liveCrop.url} alt="Zoomed live crop" /><figcaption>Live, zoomed on the plan</figcaption></figure>}
        {b.referenceCrop && <figure><img src={b.referenceCrop.url} alt="Zoomed reference crop" /><figcaption>Reference, zoomed on the plan</figcaption></figure>}
      </div>
      <p data-tone={c.failed ? 'error' : c.level === 'yellow' ? 'warn' : 'ok'}><b>Verdict:</b> {c.verdict}</p>
    </>
  );
}

/** One recorded briefing: objectives, comparison, cross-reference and the review that updated it. */
function BriefingItem({ b }: { b: Briefing }) {
  const o = b.objectives;
  return (
    <li data-tone={b.outcome === 'unresolved' ? 'warn' : 'ok'}>
      <small>{clock(b.time)}</small> <b>{b.stepName}</b> <small>· {b.outcome}</small>
      {b.aiNote && <p role="alert">{b.aiNote}</p>}
      <h4>Objectives</h4>
      <p><b>Goal:</b> {o.goal || '(none)'}</p>
      {o.progress && <p><b>Traced:</b> {o.progress}</p>}
      <ol>{o.sequence.map((s) => <li key={s.id}>{s.current ? <b>{s.action} "{s.target}" ← now</b> : `${s.action} "${s.target}" · ${s.status}`}</li>)}</ol>
      <p><b>What:</b> {o.what} — {o.action} "{o.target}" at ({(o.x * 100).toFixed(1)}%, {(o.y * 100).toFixed(1)}%)</p>
      <p><b>Why:</b> {o.why} <small>({o.source === 'ai' ? 'AI proposal' : 'local, AI not consulted'})</small></p>
      <BriefingComparison b={b} />
      <h4>Cross-reference {b.aiNote && <small>local memory check</small>}</h4>
      {!b.crossRef.length && <p className={styles.muted}>Nothing known about this target yet.</p>}
      <ul>{b.crossRef.map((c, i) => <li key={i} data-tone={c.status === 'consistent' ? 'ok' : 'error'}><b>{c.status}</b> [{c.source}] {c.text}</li>)}</ul>
      {b.revisions.length > 0 && (
        <>
          <h4>Review and update</h4>
          <ol>{b.revisions.map((r, i) => <li key={i}><small>{clock(r.time)}</small> <b>{r.kind}</b> {r.text}{r.snip && <img src={r.snip.url} alt={`Fresh snip for ${b.stepName}`} style={{ display: 'block', maxWidth: '100%' }} />}</li>)}</ol>
        </>
      )}
    </li>
  );
}

/** The multi-element chain: each objective's what, why and status, then the completion report (red when incomplete). */
function ChainBreakdown({ chain }: { chain: ChainRun }) {
  return (
    <div aria-label="Chain objectives">
      <h4>Objective breakdown <small>{chain.goal}</small></h4>
      <ol className={styles.log}>
        {chain.objectives.map((o) => (
          <li key={o.id} data-tone={OBJECTIVE_TONE[o.status]}>
            <b>{o.name}</b> <small>· {o.status}</small>
            <p><b>What:</b> {o.what}{o.path.length > 0 && <small> (via {o.path.join(' → ')})</small>}</p>
            <p><b>Why:</b> {o.why}</p>
            {o.reason && <p><b>Reason:</b> {o.reason}</p>}
          </li>
        ))}
      </ol>
      {chain.report && (
        <ul className={styles.log}>
          <li data-tone={chain.report.complete ? 'ok' : 'error'} role={chain.report.complete ? undefined : 'alert'}><b>{chain.report.text}</b></li>
        </ul>
      )}
    </div>
/** One snip: the image, its region and size, and Save to element map. */
function SnipItem({ engine, s }: { engine: AssistEngine; s: Snip }) {
  const [name, setName] = useState('');
  return (
    <figure>
      <img src={s.frame.url} alt={`Snip ${s.label}`} />
      <figcaption>
        <small>{clock(s.time)} · {s.by}{s.displayId ? ` · display ${s.displayId}` : ''}</small> {snipText(s)}
        {!s.displayId && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              engine.snipToMap(s.id, name);
              setName('');
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Element name" aria-label={`Name for snip ${s.label}`} />
            <button type="submit" disabled={!name.trim()}>Save to element map</button>
          </form>
        )}
      </figcaption>
    </figure>
  );
}

/** Snip gallery: regions the AI, agents, reroutes and the user snipped, newest first. */
export function SnipGalleryPanel({ engine }: { engine: AssistEngine }) {
  const { snips, snipMode } = engine;
  return (
    <section className={styles.panel} aria-label="Snip gallery">
      <h3>Snips <small>{snips.length} kept</small></h3>
      <button type="button" aria-pressed={snipMode} onClick={engine.toggleSnipMode}>{snipMode ? 'Cancel snip' : '✂ Snip a region'}</button>
      {!snips.length && <p className={styles.muted}>Press ✂ Snip and drag a region on the screen, or type /snip x,y,w,h [WxH] [display id].</p>}
      <div className={styles.gallery}>{snips.map((s) => <SnipItem key={s.id} engine={engine} s={s} />)}</div>
    </section>
  );
}

/** Pre-action briefing: the reasoning and evidence for each step, recorded before it dispatches. */
export function BriefingPanel({ engine }: { engine: AssistEngine }) {
  const { briefings, settings, chain } = engine;
  const { briefings, settings, replicas } = engine;
  return (
    <section className={styles.panel} aria-label="Pre-action briefing">
      <h3>Pre-action briefing <small>{settings.stages.briefing ? `${briefings.length} recorded` : 'stage unchecked in Loop control'}</small></h3>
      {chain && <ChainBreakdown chain={chain} />}
      {!briefings.length && <p className={styles.muted}>No step briefed yet.</p>}
      <FixScriptReview engine={engine} />
      <ul className={styles.log}>
        {briefings.map((b) => <BriefingItem key={`${b.id}:${b.revisions.length}`} b={b} />)}
      </ul>
      {replicas.length > 0 && <h4>Replicated by the AI <small>{replicas.length}</small></h4>}
      <ul className={styles.log} aria-label="Replicated elements">
        {replicas.map((r) => (
          <li key={r.id} data-tone="ok">
            <img src={r.crop} alt={`Snip of ${r.name}`} width={48} /> {replicaLine(r)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Screen sections: profiles drawn in the element map or proposed by the AI, the goal scope, cross-section memory and side tests. */
export function SectionsPanel({ engine }: { engine: AssistEngine }) {
  const { sectionProfiles, scope, mapDraft, sideResults } = engine;
  const [name, setName] = useState('');
  return (
    <section className={styles.panel} aria-label="Screen sections">
      <h3>Screen sections <small>{sectionProfiles.length} · scope {scope.length ? scope.join(', ') : 'whole screen'}</small></h3>
      <button type="button" onClick={() => void engine.proposeSections()}>AI propose sections</button>
      {mapDraft && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            engine.saveSection(name);
            setName('');
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Section name" aria-label="Section name" />
          <button type="submit" disabled={!name.trim()}>Save drawn box as section</button>
        </form>
      )}
      <ul className={styles.log}>
        {sectionProfiles.map(({ section, elements, log, changes }) => (
          <li key={section.id} data-tone={scope.includes(section.name) ? 'ok' : 'info'}>
            <b>{section.name}</b> <small>· {section.source} · {mapCells(section.box)} · {elements.length} element(s) · {log.length} log · {changes.length} change(s)</small>
            <button type="button" aria-label={`Delete section ${section.name}`} onClick={() => engine.deleteSection(section.id)}>✕</button>
            <ul>{elements.map((el) => <li key={el.name}><small>{el.dossier}</small></li>)}</ul>
          </li>
        ))}
      </ul>
      <h4>Section memory</h4>
      <ul className={styles.log} aria-label="Section memory">
        {sectionMemoryLines(sectionProfiles).map((line) => <li key={line} data-tone="info"><small>{line}</small></li>)}
      </ul>
      <h4>Side tests <small>{sideResults.length}</small></h4>
      <ul className={styles.log} aria-label="Side tests">
        {sideResults.map((r) => <li key={r.id} data-tone={r.status === 'passed' ? 'ok' : 'warn'}><small>{feedbackLine(r)}</small></li>)}
      </ul>
    </section>
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

/** One suggested step correction, as shown in the Supervisor panel. */
function fixText(f: StepFix): string {
  const at = f.x !== undefined && f.y !== undefined ? ` → (${(f.x * 100).toFixed(1)}%, ${(f.y * 100).toFixed(1)}%)` : '';
  const target = f.target ? ` target "${f.target}"` : '';
  const text = f.text ? ` text "${f.text}"` : '';
  return `Step ${f.index}${f.name ? ` "${f.name}"` : ''}${target}${text}${at}${f.reason ? ` — ${f.reason}` : ''}`;
}

/** Supervisor review: its assessment and the concrete updates it applied or only suggests. */
export function SupervisorPanel({ engine }: { engine: AssistEngine }) {
  const { supervisor, agents } = engine;
  const { review } = supervisor;
  const on = agents.some((a) => a.id === 'supervisor' && a.on);
  return (
    <section className={styles.panel} aria-label="Supervisor review">
      <h3>Supervisor review <small>{supervisor.status}</small></h3>
      <button type="button" onClick={() => void engine.invoke('supervisor.review')} disabled={!on || supervisor.status === 'reviewing'}>Review now</button>
      {supervisor.status === 'offline' || supervisor.status === 'error' ? <p role="alert">{supervisor.detail}</p> : !review && <p className={styles.muted}>{supervisor.detail}</p>}
      {review && (
        <>
          <p><b>{review.planOk ? 'Plan OK' : 'Plan needs updates'}</b> · confidence {review.confidence.toFixed(2)} · {supervisor.applied ? 'auto-applied' : 'suggested only'}</p>
          <p>{review.assessment}</p>
          <ul className={styles.log}>
            {review.stepFixes.map((f) => <li key={f.stepId} data-tone="warn">{fixText(f)}</li>)}
            {review.habits.map((h) => <li key={`${h.kind}:${h.pattern}`} data-tone={h.kind === 'avoid' ? 'warn' : 'ok'}><b>{h.kind === 'avoid' ? 'Avoid' : 'Add'}</b> {h.pattern}</li>)}
          </ul>
        </>
      )}
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
          <li key={l.id} id={`log-${l.id}`} data-tone={l.tone}>
            <time>{new Date(l.time).toLocaleTimeString()}</time> <b>{l.source}</b> {l.message}
            {l.shots && (
              <span>
                {l.shots.map((url, i) => <img key={i} src={url} alt={i === 0 ? 'before' : 'after'} width={120} />)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
