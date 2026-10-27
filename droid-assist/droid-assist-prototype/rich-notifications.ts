import { uid } from './planner.js';
import type { DispatchState } from './safety.js';

/** How important a notification is; drives its accent, icon and whether it stays until dismissed. */
export type NotifySeverity = 'info' | 'success' | 'warning' | 'critical';

/** One button on a notification. `input` actions drive the PC and run only through the real-input path. */
export interface NotifyAction {
  id: string;
  label: string;
  input?: boolean;
}

/** A rich notification: its own record, never a log entry — title, body, optional image and action buttons. */
export interface RichNotification {
  id: string;
  time: number;
  /** What raised it (e.g. "slideshow", "movie", "follow-up", "approval"); same topic + title replaces the older one. */
  topic: string;
  severity: NotifySeverity;
  title: string;
  body: string;
  /** A screenshot or slide image (data URL). */
  image?: string;
  actions: NotifyAction[];
  read: boolean;
}

/** What a notification is raised with. */
export type NotifyInput = Omit<RichNotification, 'id' | 'time' | 'read' | 'actions'> & { actions?: NotifyAction[] };

/** Most notifications kept (newest first). */
export const NOTIFY_LIMIT = 30;
/** How long a non-sticky notification stays on screen as a toast. */
export const TOAST_MS = 8000;

/** A notification from its input at `now`, unread. */
export const createNotification = (input: NotifyInput, now = Date.now()): RichNotification => ({ ...input, actions: input.actions ?? [], id: uid('notify'), time: now, read: false });

/** `n` added newest first; an earlier one with the same topic and title is replaced; at most NOTIFY_LIMIT kept. */
export const addNotification = (list: RichNotification[], n: RichNotification): RichNotification[] => [n, ...list.filter((x) => !(x.topic === n.topic && x.title === n.title))].slice(0, NOTIFY_LIMIT);

/** The list without notification `id`. */
export const dismissNotification = (list: RichNotification[], id: string) => list.filter((n) => n.id !== id);

/** The list with notification `id` marked read. */
export const markRead = (list: RichNotification[], id: string) => list.map((n) => (n.id === id ? { ...n, read: true } : n));

/** How each severity looks: accent colour, icon, ARIA role and whether it stays until dismissed. */
export const SEVERITY_STYLE: Record<NotifySeverity, { accent: string; icon: string; role: 'status' | 'alert'; sticky: boolean }> = {
  info: { accent: '#38bdf8', icon: 'ℹ', role: 'status', sticky: false },
  success: { accent: '#22c55e', icon: '✔', role: 'status', sticky: false },
  warning: { accent: '#f59e0b', icon: '⚠', role: 'alert', sticky: true },
  critical: { accent: '#ef4444', icon: '⛔', role: 'alert', sticky: true },
};

/** Everything the notification card renders. */
export interface NotificationView {
  id: string;
  title: string;
  body: string;
  image: string | null;
  accent: string;
  icon: string;
  role: 'status' | 'alert';
  sticky: boolean;
  actions: Array<NotifyAction & { hint: string | null }>;
}

/** The card of `n`: its severity style, image and buttons; an input action shows why it will only dry-run. */
export function notificationView(n: RichNotification, dispatch: DispatchState): NotificationView {
  const style = SEVERITY_STYLE[n.severity];
  const hint = (a: NotifyAction) => (a.input && !dispatch.real ? `${dispatch.label}: ${dispatch.reason}` : null);
  return { id: n.id, title: n.title, body: n.body, image: n.image ?? null, ...style, actions: n.actions.map((a) => ({ ...a, hint: hint(a) })) };
}

/** Notifications that show as toasts at `now`: unread, and sticky or younger than TOAST_MS. */
export const visibleToasts = (list: RichNotification[], now: number) => list.filter((n) => !n.read && (SEVERITY_STYLE[n.severity].sticky || now - n.time < TOAST_MS));
