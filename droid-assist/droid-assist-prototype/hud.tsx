import type { AssistEngine } from './use-assist.js';
import type { MonitorMode, ScreenSource, SyncLevel } from './types.js';
import type { AiStatus } from './ai.js';
import { MONITOR_MODES } from './capture.js';
import styles from './droid-assist.module.css';

const SYNC_LABEL: Record<SyncLevel, string> = { green: 'Aligned', yellow: 'Drift — correcting', red: 'Mismatch', idle: 'Idle' };
const SOURCE_LABEL: Record<ScreenSource, string> = { none: 'None', demo: 'Demo desktop', screen: 'Screen capture', bridge: 'Desktop bridge' };
const AI_LEVEL: Record<AiStatus['state'], SyncLevel> = { online: 'green', checking: 'yellow', offline: 'red' };
const AI_LABEL: Record<AiStatus['state'], string> = { online: 'AI connected', checking: 'AI connecting…', offline: 'AI unavailable' };

/** Live state of the AI endpoint: connected, connecting, or the reason it is unavailable. */
export function AiStatusBadge({ status }: { status: AiStatus }) {
  return (
    <div className={styles.sync} data-level={AI_LEVEL[status.state]} title={status.detail} aria-live="polite">
      <span className={styles.syncDot} />
      <strong>{AI_LABEL[status.state]}</strong>
      <span className={styles.syncDetail}>{status.detail}</span>
    </div>
  );
}

/** Monitor HUD: mode picker, capture interval, screenshot count, source and /use target. */
export function MonitorStatus({ engine }: { engine: AssistEngine }) {
  const { settings, setSettings, intervalMs, shotCount, source, target } = engine;
  return (
    <div className={styles.hud2} aria-label="Monitor status">
      <label>Monitor
        <select value={settings.monitorMode} onChange={(e) => setSettings({ ...settings, monitorMode: e.target.value as MonitorMode })} aria-label="Monitor mode">
          {(Object.keys(MONITOR_MODES) as MonitorMode[]).map((m) => <option key={m} value={m}>{MONITOR_MODES[m].label}</option>)}
        </select>
      </label>
      <span>⏱ every <b>{intervalMs} ms</b></span>
      <span>📸 <b>{shotCount}</b> screenshots</span>
      <span>Source: <b>{SOURCE_LABEL[source]}</b></span>
      {target && <span>Using: <b>{target}</b></span>}
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

/** Safety controls: one-click arm/disarm of real input, emergency stop and the ABORTED state. */
export function SafetyControls({ engine }: { engine: AssistEngine }) {
  const { armed, aborted, settings } = engine;
  return (
    <div className={styles.safety} data-armed={armed} data-aborted={aborted} aria-live="assertive">
      <button type="button" className={armed ? styles.danger : ''} onClick={engine.toggleArmed} aria-pressed={armed} title="Real input is only sent to the PC while armed; disarmed runs are dry runs">
        {armed ? '🔴 Real input ARMED — click to disarm' : '🟢 Dry run (disarmed) — click to arm real input'}
      </button>
      {aborted ? (
        <>
          <strong className={styles.aborted}>⛔ ABORTED</strong>
          <button type="button" onClick={engine.clearAbort}>Clear abort</button>
        </>
      ) : (
        <button type="button" className={styles.danger} onClick={() => engine.triggerAbort('stop button')} title={`Emergency stop (${settings.abortHotkey})`}>
          ⛔ Emergency stop <small>{settings.abortHotkey}</small>
        </button>
      )}
    </div>
  );
}

/** Primary HUD: screen source, record / replay / self-test, goal + AI plan. */
export function Hud({ engine }: { engine: AssistEngine }) {
  const { source, recording, replaying, goal, setGoal, settings, setSettings, steps, progress, plays, aiStatus, aiBusy } = engine;
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
          <button type="button" className={recording ? styles.danger : ''} onClick={engine.toggleRecording} disabled={replaying}>
            {recording ? '■ Stop recording' : '● Record'}
          </button>
          {replaying ? (
            <button type="button" className={styles.danger} onClick={engine.stop}>■ Stop</button>
          ) : (
            <>
              <button type="button" className={styles.primary} onClick={() => engine.replay(false)} disabled={recording || !total} title="Performs every step as real input on the PC through the desktop bridge">▶ Replay + drift</button>
              <button type="button" onClick={() => engine.replay(true)} disabled={recording || !total} title="Verifies each step on the live desktop; sends no input">🧪 AI self-test (no input)</button>
            </>
          )}
          <button type="button" onClick={() => void engine.explainScreen()} disabled={aiOff || aiBusy} title={aiTitle}>👁 Point out</button>
          <button type="button" className={engine.ruler.on ? styles.primary : ''} onClick={engine.ruler.toggle} aria-pressed={engine.ruler.on} title="Ruler mode: click points on the screen to measure distances">📏 Ruler{engine.ruler.on ? ' (on)' : ''}</button>
          <button type="button" onClick={() => engine.ruler.recalibrateNow('manual')} title="Re-measure the baseline references on the live frame and rescale stored coordinates on drift">⟲ Recalibrate</button>
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
        </form>
      </div>
      <MonitorStatus engine={engine} />
      <div className={styles.hud2}>
        <SafetyControls engine={engine} />
        <AiStatusBadge status={aiStatus} />
        <SyncStatus level={engine.sync.level} detail={engine.sync.detail} />
        <label><input type="checkbox" checked={settings.autoAct} onChange={(e) => setSettings({ ...settings, autoAct: e.target.checked })} disabled={aiOff} /> Auto act{aiOff && ' (AI unavailable)'}</label>
        <label><input type="checkbox" checked={settings.aiHelp} onChange={(e) => setSettings({ ...settings, aiHelp: e.target.checked })} disabled={aiOff} /> AI help{aiOff && ' (AI unavailable)'}</label>
        <label><input type="checkbox" checked={settings.showTrail} onChange={(e) => setSettings({ ...settings, showTrail: e.target.checked })} /> Trail</label>
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
