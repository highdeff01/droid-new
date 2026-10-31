import type { AssistEngine } from './use-assist.js';
import { updateText } from './use-update.js';
import styles from './droid-assist.module.css';

/** Settings → Updates: the toggle, the manual check, and the state of the last check or update. */
export function UpdateSettings({ engine }: { engine: AssistEngine }) {
  const { settings, setSettings, update } = engine;
  const { view, checkNow, updateNow } = update;
  const busy = view.phase === 'checking' || view.phase === 'updating';
  const unsupported = view.phase === 'unsupported';
  return (
    <>
      <h3>Updates</h3>
      <label className={styles.agent}>
        <input
          type="checkbox"
          checked={settings.autoUpdate}
          onChange={(e) => setSettings({ ...settings, autoUpdate: e.target.checked })}
          aria-label="Auto-update on start"
        />
        <span>
          <strong>Update on start</strong>
          <small>Check GitHub main when the app starts and, when it is behind, pull, rebuild and relaunch automatically — features arrive without a manual pull or rebuild.</small>
        </span>
      </label>
      <p className={styles.muted} aria-label="Update status">{updateText(view)}</p>
      <span className={styles.row}>
        <button type="button" onClick={() => void checkNow()} disabled={busy || unsupported} aria-label="Check for updates">Check for updates</button>
        <button type="button" onClick={() => void updateNow()} disabled={busy || unsupported || view.behind === 0} aria-label="Update now">Update now</button>
      </span>
      {view.latest && <p className={styles.muted}>Latest on GitHub: {view.latest}</p>}
    </>
  );
}
