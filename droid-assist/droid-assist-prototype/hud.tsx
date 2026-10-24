import type { AssistEngine } from './use-assist.js';
import type { SyncLevel } from './types.js';
import styles from './droid-assist.module.css';

const SYNC_LABEL: Record<SyncLevel, string> = { green: 'Aligned', yellow: 'Drift — correcting', red: 'Mismatch', idle: 'Idle' };

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

/** Primary HUD: screen source, record / replay / self-test, goal + AI plan. */
export function Hud({ engine }: { engine: AssistEngine }) {
  const { source, recording, replaying, goal, setGoal, settings, setSettings, steps, progress, plays } = engine;
  const total = steps.length;
  const done = steps.filter((s) => s.status === 'done').length;
  return (
    <>
      <div className={styles.hud}>
        <div className={styles.group}>
          {source === 'demo' ? (
            <button type="button" onClick={engine.shareScreen}>🖥 Share my screen</button>
          ) : (
            <button type="button" onClick={engine.useDemo}>Use demo desktop</button>
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
          <button type="button" onClick={engine.explainScreen}>👁 Point out</button>
        </div>
        <div className={styles.goal}>
          <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder='Goal, e.g. "play the game", "calculate 12*7", "search ad blocker"' aria-label="Goal" />
          <button type="button" className={styles.primary} onClick={engine.autoPlan}>✨ AI plan</button>
        </div>
      </div>
      <div className={styles.hud2}>
        <SyncStatus level={engine.sync.level} detail={engine.sync.detail} />
        <label><input type="checkbox" checked={settings.autoAct} onChange={(e) => setSettings({ ...settings, autoAct: e.target.checked })} /> Auto act</label>
        <label><input type="checkbox" checked={settings.aiHelp} onChange={(e) => setSettings({ ...settings, aiHelp: e.target.checked })} /> AI help</label>
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
