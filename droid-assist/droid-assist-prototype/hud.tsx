import type { AssistEngine } from './use-assist.js';
import type { MonitorMode, ScreenSource, SyncLevel } from './types.js';
import type { AiConfig, AiStatus } from './ai.js';
import { MONITOR_MODES } from './capture.js';
import { insecureBridgeUrl } from './bridge.js';
import { GRID_OPACITY_RANGE } from './grid-overlay.js';
import { DisplayPicker } from './display-picker.js';
import { EXECUTION_MODES, MODE_IDS, type ExecutionMode } from './execution-mode.js';
import { MAX_SHIFT_LIMIT, sanitizeAutoApply, type AutoApplyBounds } from './aggressive.js';
import type { MainBridgeState, MainBridgeStatus } from './main-bridge.js';
import styles from './droid-assist.module.css';

const SYNC_LABEL: Record<SyncLevel, string> = { green: 'Aligned', yellow: 'Drift — correcting', red: 'Mismatch', idle: 'Idle' };
const SOURCE_LABEL: Record<ScreenSource, string> = { none: 'None', demo: 'Demo desktop', screen: 'Screen capture', bridge: 'Desktop bridge', 'main-app': 'Main app preview' };
const AI_LEVEL: Record<AiStatus['state'], SyncLevel> = { online: 'green', checking: 'yellow', offline: 'red' };
const AI_LABEL: Record<AiStatus['state'], string> = { online: 'AI connected', checking: 'AI connecting…', offline: 'AI unavailable' };
const MAIN_LEVEL: Record<MainBridgeStatus, SyncLevel> = { off: 'idle', waiting: 'yellow', connecting: 'yellow', connected: 'green', error: 'red' };
const MAIN_LABEL: Record<MainBridgeStatus, string> = { off: 'Main app bridge off', waiting: 'Waiting for main app', connecting: 'Connecting to main app…', connected: 'Connected', error: 'Error' };

/** Live state of the main Droid app bridge: waiting, connected (with the peer) or the last error in plain words. */
export function MainBridgeBadge({ state }: { state: MainBridgeState }) {
  const detail = state.status === 'error' ? state.lastError ?? '' : state.peer ?? '';
  return (
    <div className={styles.sync} data-level={MAIN_LEVEL[state.status]} title={detail} aria-live="polite" aria-label="Main app bridge status">
      <span className={styles.syncDot} />
      <strong>Main app: {MAIN_LABEL[state.status]}</strong>
      {detail && <span className={styles.syncDetail}>{detail}</span>}
    </div>
  );
}

/** The endpoint+model summary line, e.g. "qwen3.5:2b @ https://quantumclaw.net/ollama/api/chat". */
export const aiSummary = ({ url, model }: AiConfig) => `${model} @ ${url}`;

/** Live state of the AI endpoint: connected, connecting, or the reason it is unavailable; with `config`, the active endpoint+model too. */
export function AiStatusBadge({ status, config }: { status: AiStatus; config?: AiConfig }) {
  return (
    <div className={styles.sync} data-level={AI_LEVEL[status.state]} title={status.detail} aria-live="polite">
      <span className={styles.syncDot} />
      <strong>{AI_LABEL[status.state]}</strong>
      <span className={styles.syncDetail}>{status.detail}</span>
      {config && <small className={styles.syncDetail} data-testid="ai-summary">{aiSummary(config)}</small>}
    </div>
  );
}

/** Loud warning shown while the bridge URL is plain http to a non-localhost host. */
export function InsecureBridgeWarning({ bridgeUrl }: { bridgeUrl: string }) {
  if (!insecureBridgeUrl(bridgeUrl)) return null;
  return (
    <div className={styles.insecure} role="alert">
      ⚠ INSECURE BRIDGE: {bridgeUrl} is plain http on a non-localhost address — the bridge token and every mouse/keyboard command cross the network unencrypted. Use https or a localhost URL.
    </div>
  );
}

/** Monitor HUD: mode picker, capture interval, screenshot count, source and /use target. */
export function MonitorStatus({ engine }: { engine: AssistEngine }) {
  const { settings, intervalMs, shotCount, source, target, aiQueue } = engine;
  return (
    <div className={styles.hud2} aria-label="Monitor status">
      <label>Monitor
        <select value={settings.monitorMode} onChange={(e) => void engine.invoke('setting.monitorMode', { value: e.target.value })} aria-label="Monitor mode">
          {Object.keys(MONITOR_MODES).map((m) => <option key={m} value={m}>{MONITOR_MODES[m as MonitorMode].label}</option>)}
        </select>
      </label>
      <DisplayPicker engine={engine} compact />
      <span>⏱ every <b>{intervalMs} ms</b></span>
      <span>📸 <b>{shotCount}</b> screenshots</span>
      <span>Source: <b>{SOURCE_LABEL[source]}</b></span>
      {target && <span>Using: <b>{target}</b></span>}
      <span aria-label="AI queue" title={`At most ${settings.aiMaxInFlight} AI call(s) run at once; the rest wait by priority`}>🧠 AI <b>{aiQueue.inFlight}/{settings.aiMaxInFlight}</b> in flight · <b>{aiQueue.queued}</b> queued</span>
    </div>
  );
}

/** Real-time sync indicator: live frame vs the active workflow step. */
export function SyncStatus({ level, detail }: { level: SyncLevel; detail: string }) {
  return (
    <div className={styles.sync} data-level={level} title={detail} aria-live="polite">
      <span className={styles.syncDot} />
      <strong>{SYNC_LABEL[level]}</strong>
      <span className={styles.syncDetail}>{detail}</span>
    </div>
  );
}

/** AI Stop: shown while the AI is busy or an auto-continue run is going; cancels the model call and the run. */
export function AiStopButton({ engine }: { engine: AssistEngine }) {
  if (!engine.aiWorking && !engine.continuing) return null;
  return (
    <button type="button" className={styles.danger} onClick={() => void engine.invoke('guard.abort', { reason: 'AI stop button' })} title="Cancel the in-flight AI call and stop auto-continue (latches ABORTED)">
      ■ Stop AI{engine.continuing ? ' (auto-continue)' : ''}
    </button>
  );
}

/**
 * Stop plan: shown while a plan, crew or live drag is going; halts it (AI calls cancelled, agents parked,
 * a live drag released) without disarming or stopping the monitor and the watchers — unlike the emergency stop.
 */
export function StopPlanButton({ engine }: { engine: AssistEngine }) {
  if (!engine.aiWorking && !engine.continuing && !engine.replaying && !engine.crewRunning && !engine.liveDragging) return null;
  return (
    <button type="button" onClick={engine.stopPlan} title="Stop the current plan and agent crew; stays armed, monitor and watchers keep running (no ABORTED latch)">
      ⏹ Stop plan{engine.crewRunning ? ' (crew)' : ''}
    </button>
  );
}

/**
 * Persistent real-input indicator: "Real input ACTIVE" only while armed, the bridge is connected
 * and the executor stage is on; otherwise "Dry run" with the reason. Plus the end-to-end
 * "Verify real input" self-test (one harmless cursor move through the bridge).
 */
export function RealInputIndicator({ engine }: { engine: AssistEngine }) {
  const { dispatch } = engine;
  return (
    <>
      <strong className={styles.realInput} data-real={dispatch.real} aria-live="polite" title={dispatch.reason}>
        {dispatch.real ? '⚡ Real input ACTIVE' : '🧪 Dry run'} <small>{dispatch.reason}</small>
      </strong>
      <button type="button" onClick={() => void engine.verifyRealInput()} title="Sends one harmless cursor move through the bridge and reports the PC's confirmation">
        ✓ Verify real input
      </button>
    </>
  );
}

/**
 * Reverse: offered right after a real action; a dry run unless real input is armed. A
 * non-invertible action says "cannot reverse" with the reason instead of a button.
 */
export function ReverseControl({ engine }: { engine: AssistEngine }) {
  const { reverse, armed, reversing } = engine;
  if (!reverse) return null;
  const { record, reversal } = reverse;
  const what = `${record.action} at (${record.x}, ${record.y})px`;
  if (!reversal.ok) {
    return <span className={styles.syncDetail} aria-label="Reverse last action" title={reversal.reason}>↶ Last {what}: cannot reverse — {reversal.reason}</span>;
  }
  return (
    <button type="button" aria-label="Reverse last action" onClick={() => void engine.invoke('reverse.last')} disabled={reversing} title={reversal.summary}>
      ↶ Reverse {what}{armed ? '' : ' (dry run)'}
    </button>
  );
}

/** Safety controls: one-click arm/disarm of real input, emergency stop and the ABORTED state. */
export function SafetyControls({ engine }: { engine: AssistEngine }) {
  const { armed, aborted, settings } = engine;
  return (
    <div className={styles.safety} data-armed={armed} data-aborted={aborted} aria-live="assertive">
      <RealInputIndicator engine={engine} />
      <button type="button" className={armed ? styles.danger : ''} onClick={() => void engine.invoke('guard.arm', { on: !armed })} aria-pressed={armed} title="Real input is only sent to the PC while armed; disarmed runs are dry runs">
        {armed ? '🔴 Real input ARMED — click to disarm' : '🟢 Dry run (disarmed) — click to arm real input'}
      </button>
      {aborted ? (
        <>
          <strong className={styles.aborted}>⛔ ABORTED</strong>
          <button type="button" onClick={() => void engine.invoke('guard.clearAbort')}>Clear abort</button>
        </>
      ) : (
        <button type="button" className={styles.danger} onClick={() => void engine.invoke('guard.abort', { reason: 'stop button' })} title={`Emergency stop (${settings.abortHotkey})`}>
          ⛔ Emergency stop <small>{settings.abortHotkey}</small>
        </button>
      )}
    </div>
  );
}

/** The newest crew notifications (off-position targets, wrong path, intercepts, tests), so none is silent. */
export function CrewNotices({ engine }: { engine: AssistEngine }) {
  const latest = engine.crew.notices.slice(0, 3);
  if (!latest.length) return null;
  return (
    <ul className={styles.hud2} role="status" aria-label="Crew notifications">
      {latest.map((n) => <li key={n.id}>ℹ <b>{n.agentId}</b> {n.text}</li>)}
    </ul>
  );
}

/** Execution mode selector, the last mode change, and the auto-apply bounds aggressive mode stays within. */
export function ModeControls({ engine }: { engine: AssistEngine }) {
  const { settings, setSettings, modeChange } = engine;
  const bounds = settings.autoApply;
  const setBounds = (patch: Partial<AutoApplyBounds>) => setSettings({ ...settings, autoApply: sanitizeAutoApply({ ...bounds, ...patch }) });
  return (
    <div className={styles.hud2} aria-label="Execution mode">
      <label title={EXECUTION_MODES[settings.executionMode].description}>Mode
        <select value={settings.executionMode} onChange={(e) => engine.setMode(e.target.value as ExecutionMode, 'selected in the HUD', 'user')} aria-label="Execution mode">
          {MODE_IDS.map((m) => <option key={m} value={m}>{EXECUTION_MODES[m].label}</option>)}
        </select>
      </label>
      {modeChange && <span aria-label="Last mode change">{modeChange}</span>}
      {settings.executionMode === 'aggressive' && (
        <>
          <label title="Off: every aggressive candidate waits for your Apply"><input type="checkbox" checked={bounds.enabled} onChange={(e) => setBounds({ enabled: e.target.checked })} aria-label="Auto-apply" /> Auto-apply</label>
          <label>Min confidence <input type="number" min={0} max={1} step={0.05} value={bounds.minConfidence} onChange={(e) => setBounds({ minConfidence: e.target.valueAsNumber })} aria-label="Auto-apply min confidence" /></label>
          <label>Max shift <input type="number" min={0} max={MAX_SHIFT_LIMIT} step={0.01} value={bounds.maxShift} onChange={(e) => setBounds({ maxShift: e.target.valueAsNumber })} aria-label="Auto-apply max shift" /></label>
          <label>Max per run <input type="number" min={1} step={1} value={bounds.maxPerRun} onChange={(e) => setBounds({ maxPerRun: e.target.valueAsNumber })} aria-label="Auto-apply max per run" /></label>
        </>
      )}
      {engine.candidates.map((c) => (
        <span key={c.id} aria-label={`Candidate ${c.step.name}`}>
          ⚡ {c.step.name} <small>{c.reason}</small>
          <button type="button" onClick={() => void engine.applyCandidate(c.id)} title={engine.armed ? 'Real input (armed, budgeted)' : 'Dry run — nothing is sent'}>Apply</button>
          <button type="button" onClick={() => engine.dismissCandidate(c.id)}>Dismiss</button>
        </span>
      ))}
    </div>
  );
}

/** Primary HUD: screen source, record / replay / self-test, goal + AI plan. */
export function Hud({ engine }: { engine: AssistEngine }) {
  const { source, recording, replaying, goal, setGoal, settings, setSettings, steps, progress, plays, aiStatus, aiBusy, armed } = engine;
  const aiOff = aiStatus.state !== 'online';
  const aiTitle = aiOff ? aiStatus.detail : undefined;
  const total = steps.length;
  const done = steps.filter((s) => s.status === 'done').length;
  return (
    <>
      <div className={styles.hud}>
        <div className={styles.group}>
          {source === 'demo' ? (
            <button type="button" onClick={engine.shareScreen}>🖥 {window.droidNative ? 'Capture my screen' : 'Share my screen'}</button>
          ) : (
            <>
              {engine.captureLost && <button type="button" className={styles.danger} onClick={engine.shareScreen}>↻ Restart capture</button>}
              <button type="button" onClick={engine.useDemo}>Use demo desktop</button>
            </>
          )}
          {engine.mainBridge.status === 'connected' && source !== 'main-app' && (
            <button type="button" onClick={engine.selectMainApp} title="The AI sees and acts on the main Droid app's preview">📱 Use main app preview</button>
          )}
          <button type="button" className={recording ? styles.danger : ''} onClick={engine.toggleRecording} disabled={replaying}>
            {recording ? '■ Stop recording' : '● Record'}
          </button>
          {replaying ? (
            <button type="button" className={styles.danger} onClick={() => void engine.invoke('replay.stop')}>■ Stop</button>
          ) : (
            <>
              <button type="button" className={styles.primary} onClick={() => void engine.invoke('replay.run', { selfTest: false })} disabled={recording || !total} title={armed ? 'Performs every step as real input through the connected bridge' : 'Verifies steps against the available frame; sends no input'}>▶ Replay + drift</button>
              <button type="button" onClick={() => void engine.invoke('replay.run', { selfTest: true })} disabled={recording || !total} title="Verifies each step against the available frame; sends no input">🧪 AI self-test (no input)</button>
            </>
          )}
          <button type="button" onClick={() => void engine.explainScreen()} disabled={aiOff || aiBusy} title={aiTitle}>👁 Point out</button>
          <button type="button" className={engine.ruler.on ? styles.primary : ''} onClick={engine.ruler.toggle} aria-pressed={engine.ruler.on} title="Ruler mode: click points on the screen to measure distances">📏 Ruler{engine.ruler.on ? ' (on)' : ''}</button>
          <button type="button" onClick={() => engine.ruler.recalibrateNow('manual')} title="Re-measure the baseline references on the live frame and rescale stored coordinates on drift">⟲ Recalibrate</button>
          <button type="button" className={engine.snipMode ? styles.primary : ''} onClick={engine.toggleSnipMode} aria-pressed={engine.snipMode} title="Snip: drag a region of the screen to save it to the snip gallery">✂ Snip{engine.snipMode ? ' (drag)' : ''}</button>
        </div>
        <form
          className={styles.goal}
          onSubmit={(e) => {
            e.preventDefault();
            void engine.submitInput();
          }}
        >
          <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder='Goal or command, e.g. "move mouse to the files icon", "/move files icon", "/use notepad"' aria-label="Goal" />
          <button type="submit" className={styles.primary} disabled={aiBusy || (aiOff && !goal.trim().startsWith('/'))} title={aiTitle}>{aiBusy ? '… thinking' : '✨ AI plan / run'}</button>
          <AiStopButton engine={engine} />
          <StopPlanButton engine={engine} />
        </form>
      </div>
      <MonitorStatus engine={engine} />
      <ModeControls engine={engine} />
      <InsecureBridgeWarning bridgeUrl={settings.bridgeUrl} />
      <CrewNotices engine={engine} />
      <div className={styles.hud2}>
        <SafetyControls engine={engine} />
        <ReverseControl engine={engine} />
        <AiStatusBadge status={aiStatus} config={{ url: settings.aiUrl, model: settings.aiModel }} />
        <MainBridgeBadge state={engine.mainBridge} />
        <SyncStatus level={engine.sync.level} detail={engine.sync.detail} />
        <label><input type="checkbox" checked={settings.autoAct} onChange={(e) => void engine.invoke('autoact.set', { on: e.target.checked })} disabled={aiOff} /> Auto act{aiOff && ' (AI unavailable)'}</label>
        <label><input type="checkbox" checked={settings.aiHelp} onChange={(e) => setSettings({ ...settings, aiHelp: e.target.checked })} disabled={aiOff} /> AI help{aiOff && ' (AI unavailable)'}</label>
        <label title="After a replay, verify the goal on the live screen and keep planning and running until it is done"><input type="checkbox" checked={settings.autoContinue} onChange={(e) => setSettings({ ...settings, autoContinue: e.target.checked })} disabled={aiOff} /> Auto-continue{aiOff && ' (AI unavailable)'}</label>
        <label>Max iterations <input type="number" min={1} max={20} value={settings.maxIterations} onChange={(e) => void engine.invoke('setting.maxIterations', { value: Math.min(20, Math.max(1, Math.floor(e.target.valueAsNumber) || 1)) })} aria-label="Auto-continue max iterations" /></label>
        <label title="Armed bridge drags run segment by segment, corrected live by the coordinate-agent swarm (needs the Live drag swarm stage)"><input type="checkbox" checked={settings.liveDrag} onChange={(e) => setSettings({ ...settings, liveDrag: e.target.checked })} aria-label="Live drag" /> Live drag</label>
        <label><input type="checkbox" checked={settings.showTrail} onChange={(e) => setSettings({ ...settings, showTrail: e.target.checked })} /> Trail</label>
        <label title="Labeled A1..H12 grid on the preview; the AI answers with these cells"><input type="checkbox" checked={settings.showGrid} onChange={(e) => setSettings({ ...settings, showGrid: e.target.checked })} aria-label="Grid overlay" /> Grid</label>
        <label title="Label every cell (A1..H12); off shows only the edge numbers and letters"><input type="checkbox" checked={settings.gridLabels} onChange={(e) => setSettings({ ...settings, gridLabels: e.target.checked })} disabled={!settings.showGrid} aria-label="Grid cell labels" /> Grid labels</label>
        <label title="How visible the grid lines are">Grid opacity <input type="range" min={GRID_OPACITY_RANGE[0]} max={GRID_OPACITY_RANGE[1]} step={0.02} value={settings.gridOpacity} onChange={(e) => setSettings({ ...settings, gridOpacity: e.target.valueAsNumber })} disabled={!settings.showGrid} aria-label="Grid opacity" /></label>
        <div className={styles.progress} title="Auto progress (verified steps) + manual updates">
          <span>Progress {total ? Math.round((done / total) * 100) : 0}%</span>
          <span className={styles.bar}><span style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></span>
          <span>✔ {progress.done} auto · {progress.manual} manual</span>
          <button type="button" onClick={() => engine.setProgress({ ...progress, manual: progress.manual + 1 })} aria-label="Add manual progress">+1</button>
          {source === 'demo' && <span>🎮 plays: {plays}</span>}
        </div>
      </div>
    </>
  );
}
