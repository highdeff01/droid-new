import type { AssistEngine } from './use-assist.js';
import { CATEGORY_IDS, NOTIFY_CATEGORIES, actionText, dimmed, type AssistNotification } from './notifications.js';
import styles from './droid-assist.module.css';

const TONE: Record<AssistNotification['severity'], string> = { info: 'info', warning: 'warn', critical: 'error' };

/** One notification: severity, time, source, title and its proposed action with a Run button. */
function NotificationRow({ n, engine }: { n: AssistNotification; engine: AssistEngine }) {
  return (
    <li data-tone={TONE[n.severity]} style={{ opacity: dimmed(n, engine.settings.relaxMode) ? 0.5 : 1, fontWeight: n.read ? 'normal' : 'bold' }}>
      <small>{new Date(n.time).toLocaleTimeString()} · {n.severity.toUpperCase()} · {n.source}</small> {n.title}
      {n.action && (
        <> <button type="button" onClick={() => void engine.actOnNotification(n.id)}>{actionText(n.action)}</button>{n.acted && <small> · {n.acted}</small>}</>
      )}
      {!n.read && <> <button type="button" onClick={() => engine.markRead(n.id)} aria-label={`Mark "${n.title}" read`}>✓</button></>}
    </li>
  );
}

/** Per-category auto-act switches (all off by default). */
function AutoActToggles({ engine }: { engine: AssistEngine }) {
  const { settings, setSettings } = engine;
  return (
    <details>
      <summary>Auto-act per category</summary>
      <small>When on, a new notification's proposed action is performed as real input through the bridge, inside every guardrail (arm, budget, abort, loop control) and briefed first when briefings are on.</small>
      {CATEGORY_IDS.map((c) => (
        <label key={c} className={styles.agent}>
          <input type="checkbox" checked={settings.notifyAutoAct[c]} onChange={(e) => setSettings({ ...settings, notifyAutoAct: { ...settings.notifyAutoAct, [c]: e.target.checked } })} aria-label={`Auto-act on ${NOTIFY_CATEGORIES[c]}`} />
          <span><strong>{NOTIFY_CATEGORIES[c]}</strong></span>
        </label>
      ))}
    </details>
  );
}

/** The notification center: important events from across the engine, suggestions and auto-act. */
export function NotificationsPanel({ engine }: { engine: AssistEngine }) {
  const { notifications } = engine;
  const unread = notifications.filter((n) => !n.read).length;
  return (
    <section className={styles.panel} aria-label="Notifications">
      <h3>Notifications <small>{unread} unread{engine.settings.relaxMode ? ' · relaxation mode' : ''}</small></h3>
      <span className={styles.row}>
        <button type="button" onClick={() => void engine.refreshSuggestions()}>Suggest</button>
        <button type="button" onClick={engine.markAllRead} disabled={!unread}>Mark all read</button>
        <button type="button" onClick={engine.clearNotifications} disabled={!notifications.length}>Clear</button>
      </span>
      <AutoActToggles engine={engine} />
      {!notifications.length && <p className={styles.muted}>No notifications yet.</p>}
      <ul className={styles.log}>{notifications.map((n) => <NotificationRow key={n.id} n={n} engine={engine} />)}</ul>
    </section>
  );
}
