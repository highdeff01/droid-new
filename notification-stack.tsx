import { useEffect, useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { notificationView, visibleToasts, type NotificationView } from './rich-notifications.js';

/** One rich notification card: accent, icon, image, body and action buttons (input actions say when they only dry-run). */
function NotificationCard({ view, onAct, onDismiss }: { view: NotificationView; onAct: (actionId: string) => void; onDismiss: () => void }) {
  return (
    <article role={view.role} aria-label={view.title} style={{ borderLeft: `4px solid ${view.accent}`, background: '#0f172a', color: '#e2e8f0', padding: 8, borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,.4)', width: 320 }}>
      <header style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span aria-hidden style={{ color: view.accent }}>{view.icon}</span>
        <b style={{ flex: 1 }}>{view.title}</b>
        <button type="button" aria-label="Dismiss" onClick={onDismiss}>×</button>
      </header>
      {view.image && <img src={view.image} alt="" width={300} style={{ borderRadius: 4, marginTop: 4 }} />}
      <p style={{ margin: '4px 0' }}>{view.body}</p>
      {!!view.actions.length && (
        <footer style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {view.actions.map((a) => <button key={a.id} type="button" title={a.hint ?? undefined} onClick={() => onAct(a.id)}>{a.label}{a.hint ? ' (dry run)' : ''}</button>)}
        </footer>
      )}
    </article>
  );
}

/** The rich notification stack: unread toasts of presentation milestones and important events, newest on top. */
export function NotificationStack({ engine }: { engine: AssistEngine }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = engine.studio;
  const toasts = visibleToasts(s.notifications, now);
  if (!toasts.length) return null;
  return (
    <div aria-label="Notifications" style={{ position: 'fixed', top: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 1000 }}>
      {toasts.map((n) => <NotificationCard key={n.id} view={notificationView(n, engine.dispatch)} onAct={(a) => s.act(n.id, a)} onDismiss={() => s.dismiss(n.id)} />)}
    </div>
  );
}
