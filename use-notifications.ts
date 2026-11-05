import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { addNotification, patchNotification, type AssistNotification, type NotificationDraft } from './notifications.js';
import { loadNotifications, saveNotifications } from './storage.js';

/**
 * The notification center's state: persisted, deduplicated notifications. `onAdded` runs for every
 * notification that was really added (not a duplicate), which is where auto-act hooks in.
 */
export function useNotifications(onAdded: (n: AssistNotification) => void) {
  const [notifications, setNotifications] = useState<AssistNotification[]>(loadNotifications);
  const listRef = useRef(notifications);
  const onAddedRef = useRef(onAdded);
  useLayoutEffect(() => {
    onAddedRef.current = onAdded;
  });

  useEffect(() => saveNotifications(notifications), [notifications]);

  const update = useCallback((fn: (list: AssistNotification[]) => AssistNotification[]) => {
    listRef.current = fn(listRef.current);
    setNotifications(listRef.current);
  }, []);

  /** Raises a notification; null when the same one was raised within the dedupe window. */
  const notify = useCallback((draft: NotificationDraft): AssistNotification | null => {
    const { list, added } = addNotification(listRef.current, draft);
    if (!added) return null;
    update(() => list);
    onAddedRef.current(added);
    return added;
  }, [update]);

  const patch = useCallback((id: string, change: Partial<AssistNotification>) => update((l) => patchNotification(l, id, change)), [update]);
  const markRead = useCallback((id: string) => patch(id, { read: true }), [patch]);
  const markAllRead = useCallback(() => update((l) => l.map((n) => (n.read ? n : { ...n, read: true }))), [update]);
  const clearNotifications = useCallback(() => update(() => []), [update]);
  /** The live list, for handlers that run outside a render. */
  const find = useCallback((id: string) => listRef.current.find((n) => n.id === id) ?? null, []);

  return { notifications, notify, patch, markRead, markAllRead, clearNotifications, find };
}
