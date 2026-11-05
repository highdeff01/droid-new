import type { AssistEngine } from './use-assist.js';
import { BREAK_MINUTES_RANGE } from './relax.js';
import { recoveryText } from './recovery.js';
import styles from './droid-assist.module.css';

/** Settings → Relaxation mode: slower automation, paused background tests, dimmed notifications, break reminders. */
export function RelaxSettings({ engine }: { engine: AssistEngine }) {
  const { settings, setSettings } = engine;
  const [min, max] = BREAK_MINUTES_RANGE;
  return (
    <>
      <h3>Relaxation mode</h3>
      <label className={styles.agent}>
        <input type="checkbox" checked={settings.relaxMode} onChange={(e) => setSettings({ ...settings, relaxMode: e.target.checked })} aria-label="Relaxation mode" />
        <span><strong>Relax</strong><small>Slower humanized steps, half the monitor rate, background agent tests paused, non-essential notifications dimmed</small></span>
      </label>
      <label className={styles.setting}>Take-a-break reminder every <b>{settings.breakMinutes} min</b>
        <input type="range" min={min} max={max} step={5} value={settings.breakMinutes} onChange={(e) => setSettings({ ...settings, breakMinutes: +e.target.value })} aria-label="Break reminder minutes" />
        <small>Only while relaxation mode is on.</small>
      </label>
    </>
  );
}

/** Settings → Data recovery: what the startup scan found, and the Restore button. */
export function RecoverySettings({ engine }: { engine: AssistEngine }) {
  const restore = () => {
    if (!window.confirm('Replace all local data with the last good export?')) return;
    // Reload so every store rehydrates from the restored storage.
    if (engine.restoreLastGood().ok) window.location.reload();
  };
  return (
    <>
      <h3>Data recovery</h3>
      <p className={styles.muted}>Startup scan: {recoveryText(engine.recovery)}{engine.recovery.lastGoodAt ? ` · last good export ${engine.recovery.lastGoodAt}` : ''}</p>
      <button type="button" onClick={restore}>Restore last good export</button>
    </>
  );
}
