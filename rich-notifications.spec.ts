import { describe, expect, it } from 'vitest';
import {
  addNotification,
  createNotification,
  dismissNotification,
  markRead,
  notificationView,
  NOTIFY_LIMIT,
  SEVERITY_STYLE,
  TOAST_MS,
  visibleToasts,
  type NotifyInput,
  type RichNotification,
} from './rich-notifications.js';
import { dispatchState } from './safety.js';

const input = (overrides: Partial<NotifyInput> = {}): NotifyInput => ({
  topic: 'slideshow',
  severity: 'info',
  title: 'Deck ready',
  body: 'Your slideshow is ready.',
  ...overrides,
});

const DISARMED = dispatchState({ armed: false, bridgeOnline: true, executorOn: true, aborted: false });
const ARMED = dispatchState({ armed: true, bridgeOnline: true, executorOn: true, aborted: false });

describe('createNotification', () => {
  it('is unread, has an id and time, and defaults actions to []', () => {
    const n = createNotification(input(), 123);
    expect(n.read).toBe(false);
    expect(n.id).toBeTruthy();
    expect(n.time).toBe(123);
    expect(n.actions).toEqual([]);
  });
});

describe('addNotification', () => {
  it('adds newest first', () => {
    const a = createNotification(input({ title: 'A' }), 1);
    const b = createNotification(input({ title: 'B' }), 2);
    const list = addNotification([a], b);
    expect(list.map((n) => n.id)).toEqual([b.id, a.id]);
  });

  it('replaces an older notification with the same topic and title', () => {
    const a = createNotification(input({ title: 'Same' }), 1);
    const b = createNotification(input({ title: 'Same' }), 2);
    const list = addNotification([a], b);
    expect(list).toEqual([b]);
  });

  it('keeps a notification with a different title', () => {
    const a = createNotification(input({ title: 'A' }), 1);
    const b = createNotification(input({ title: 'B' }), 2);
    const list = addNotification([a], b);
    expect(list).toHaveLength(2);
  });

  it('caps the list at NOTIFY_LIMIT', () => {
    let list: RichNotification[] = [];
    for (let i = 0; i < NOTIFY_LIMIT + 5; i += 1) {
      list = addNotification(list, createNotification(input({ title: `T${i}` }), i));
    }
    expect(list).toHaveLength(NOTIFY_LIMIT);
  });
});

describe('notificationView', () => {
  it.each((['info', 'success', 'warning', 'critical'] as const).map((s) => [s] as const))(
    'uses the SEVERITY_STYLE accent/icon/role for %s',
    (severity) => {
      const n = createNotification(input({ severity }), 1);
      const v = notificationView(n, ARMED);
      const style = SEVERITY_STYLE[severity];
      expect(v.accent).toBe(style.accent);
      expect(v.icon).toBe(style.icon);
      expect(v.role).toBe(style.role);
    },
  );

  it('warning and critical are sticky with role alert', () => {
    for (const severity of ['warning', 'critical'] as const) {
      const n = createNotification(input({ severity }), 1);
      const v = notificationView(n, ARMED);
      expect(v.sticky).toBe(true);
      expect(v.role).toBe('alert');
    }
  });

  it('image is null when absent', () => {
    const n = createNotification(input(), 1);
    const v = notificationView(n, ARMED);
    expect(v.image).toBeNull();
  });

  it('an input action gets the dry-run hint when disarmed', () => {
    const n = createNotification(input({ actions: [{ id: 'a1', label: 'Click it', input: true }] }), 1);
    const v = notificationView(n, DISARMED);
    expect(v.actions[0].hint).toBe('Dry run: disarmed — not dispatched');
  });

  it('an input action gets a null hint when dispatch is real', () => {
    const n = createNotification(input({ actions: [{ id: 'a1', label: 'Click it', input: true }] }), 1);
    const v = notificationView(n, ARMED);
    expect(v.actions[0].hint).toBeNull();
  });

  it('a non-input action never has a hint', () => {
    const n = createNotification(input({ actions: [{ id: 'a1', label: 'Dismiss' }] }), 1);
    const v = notificationView(n, DISARMED);
    expect(v.actions[0].hint).toBeNull();
  });
});

describe('visibleToasts', () => {
  it('hides an info notification older than TOAST_MS', () => {
    const n = createNotification(input({ severity: 'info' }), 0);
    expect(visibleToasts([n], TOAST_MS + 1)).toEqual([]);
  });

  it('keeps a sticky notification regardless of age', () => {
    const n = createNotification(input({ severity: 'critical' }), 0);
    expect(visibleToasts([n], TOAST_MS + 100000)).toEqual([n]);
  });

  it('hides a read notification', () => {
    const n = { ...createNotification(input({ severity: 'critical' }), 0), read: true };
    expect(visibleToasts([n], 0)).toEqual([]);
  });
});

describe('dismissNotification', () => {
  it('removes the notification by id', () => {
    const a = createNotification(input({ title: 'A' }), 1);
    const b = createNotification(input({ title: 'B' }), 2);
    expect(dismissNotification([a, b], a.id)).toEqual([b]);
  });
});

describe('markRead', () => {
  it('marks only the matching notification read', () => {
    const a = createNotification(input({ title: 'A' }), 1);
    const b = createNotification(input({ title: 'B' }), 2);
    const list = markRead([a, b], a.id);
    expect(list.find((n) => n.id === a.id)?.read).toBe(true);
    expect(list.find((n) => n.id === b.id)?.read).toBe(false);
  });
});
