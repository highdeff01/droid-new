import type { AssistEngine } from './use-assist.js';
import styles from './droid-assist.module.css';

/** Settings → Phone: the companion the bridge serves so a phone on the same network can watch and act. */
export function PhoneSettings({ engine }: { engine: AssistEngine }) {
  const { settings, setSettings, phone } = engine;
  const { view, start, stop } = phone;
  const set = (patch: Partial<typeof settings>) => setSettings({ ...settings, ...patch });
  return (
    <>
      <h3>Phone companion <small>{view.running ? 'listening' : view.supported ? 'stopped' : 'unavailable'}</small></h3>
      <p className={styles.muted}>
        A small page the bridge serves: both apps' status, queued approvals to answer, saved workflows to trigger, and the live screen — from a phone on the same network.
      </p>
      <label className={styles.setting}>
        <span>Port</span>
        <input type="number" min={1} max={65535} value={settings.phonePort} onChange={(e) => set({ phonePort: Number(e.target.value) })} aria-label="Phone companion port" />
      </label>
      <label className={styles.setting}>
        <span>Token <small>optional; a phone must then open the link with it</small></span>
        <input type="text" value={settings.phoneToken} onChange={(e) => set({ phoneToken: e.target.value })} aria-label="Phone companion token" placeholder="none" />
      </label>
      <span className={styles.row}>
        <button type="button" onClick={() => void start({ host: '0.0.0.0', port: settings.phonePort, token: settings.phoneToken })} disabled={!view.supported || view.running} aria-label="Start phone companion">Start</button>
        <button type="button" onClick={stop} disabled={!view.running} aria-label="Stop phone companion">Stop</button>
      </span>
      <p className={styles.muted} aria-label="Phone companion status">{view.message}</p>
      {view.running && <p className={styles.muted}>Open on your phone: <code>{view.url}</code></p>}
      {!view.supported && <p className={styles.muted}>The companion is only available in the packaged app, not a plain browser.</p>}
    </>
  );
}
