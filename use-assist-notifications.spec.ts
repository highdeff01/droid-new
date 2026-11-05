import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, useAssist } from './use-assist.js';
import { LAST_GOOD_KEY } from './recovery.js';
import { DEFAULT_AUTO_ACT } from './notifications.js';
import type { RunSummary } from './run-stats.js';
import type { AssistSettings } from './types.js';

const DAY = 86_400_000;

/** Three successful "open YouTube" runs at this time of day on three different days: a habit. */
const habitRuns = (): RunSummary[] => [1, 2, 3].map((d) => ({
  id: `r${d}`, time: Date.now() - d * DAY, session: 's', goal: 'open YouTube', attempted: 1, succeeded: 1, durationMs: 1000, outcome: 'success',
}));

const saveSettings = (patch: Partial<AssistSettings>) => localStorage.setItem('droid-assist.settings', JSON.stringify({ ...DEFAULT_SETTINGS, ...patch }));

beforeEach(() => {
  // The AI endpoint and the bridge are unreachable: every model call fails fast, the AI stays offline.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
  URL.createObjectURL = vi.fn(() => 'blob:recovery');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('useAssist startup recovery', () => {
  it('repairs a corrupted store before loading it, raises a critical notification and downloads a recovery file', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    localStorage.setItem('droid-assist.habits', '{broken');
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    expect(result.current.recovery.corrupt).toMatchObject([{ key: 'droid-assist.habits', fix: 'reset', raw: '{broken' }]);
    expect(result.current.habits).toEqual([]);
    expect(result.current.notifications.find((n) => n.source === 'Recovery')).toMatchObject({ category: 'errors', severity: 'critical' });
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it('keeps a clean startup as the last good export', async () => {
    renderHook(() => useAssist());
    await act(async () => {});
    expect(JSON.parse(localStorage.getItem(LAST_GOOD_KEY)!).format).toBeDefined();
  });

  it('restores the last good export from Settings, and refuses when there is none', async () => {
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    localStorage.removeItem(LAST_GOOD_KEY);
    expect(result.current.restoreLastGood().ok).toBe(false);
    localStorage.setItem('droid-assist.habits', JSON.stringify([]));
    renderHook(() => useAssist());
    await act(async () => {});
    expect(result.current.restoreLastGood().ok).toBe(true);
  });
});

describe('useAssist notifications', () => {
  it('notifies an abort as critical and persists it', async () => {
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    act(() => result.current.triggerAbort('test'));
    const n = result.current.notifications.find((x) => x.category === 'abort');
    expect(n).toMatchObject({ severity: 'critical', source: 'Safety', read: false });
    expect(localStorage.getItem('droid-assist.notifications')).toContain(n!.id);
    act(() => result.current.markRead(n!.id));
    expect(result.current.notifications.find((x) => x.id === n!.id)?.read).toBe(true);
    act(() => result.current.clearNotifications());
    expect(result.current.notifications).toEqual([]);
  });

  it('raises a habit suggestion with a proposed action and leaves it alone while auto-act is off (default)', async () => {
    localStorage.setItem('droid-assist.runs', JSON.stringify(habitRuns()));
    const { result } = renderHook(() => useAssist());
    await waitFor(() => expect(result.current.notifications.some((n) => n.category === 'suggestion')).toBe(true));
    const n = result.current.notifications.find((x) => x.category === 'suggestion')!;
    expect(n.action).toEqual({ kind: 'open_app', text: 'YouTube' });
    expect(n.acted).toBeUndefined();
    expect(result.current.settings.notifyAutoAct).toEqual(DEFAULT_AUTO_ACT);
  });

  it('auto-acts on a suggestion when its category is on: logged, proposed, and run as a dry run while disarmed', async () => {
    saveSettings({ notifyAutoAct: { ...DEFAULT_AUTO_ACT, suggestion: true } });
    localStorage.setItem('droid-assist.runs', JSON.stringify(habitRuns()));
    const { result } = renderHook(() => useAssist());
    await waitFor(() => expect(result.current.notifications.find((n) => n.category === 'suggestion')?.acted).toBeDefined(), { timeout: 4000 });
    const log = result.current.log.filter((l) => l.source === 'Notifications').map((l) => l.message);
    expect(log.some((m) => /^Auto-act: Open YouTube .*dry run/.test(m))).toBe(true);
    expect(log.some((m) => m.startsWith('Proposal for "Open YouTube"'))).toBe(true);
    expect(result.current.notifications.find((n) => n.category === 'suggestion')?.acted).not.toBe('skipped');
  });

  it('skips running a notification action while ABORTED is active', async () => {
    localStorage.setItem('droid-assist.runs', JSON.stringify(habitRuns()));
    const { result } = renderHook(() => useAssist());
    await waitFor(() => expect(result.current.notifications.some((n) => n.category === 'suggestion')).toBe(true));
    act(() => result.current.triggerAbort('test'));
    const id = result.current.notifications.find((n) => n.category === 'suggestion')!.id;
    await act(() => result.current.actOnNotification(id));
    expect(result.current.notifications.find((n) => n.id === id)?.acted).toBe('skipped');
    expect(result.current.log.some((l) => l.source === 'Notifications' && /skipped .*ABORTED/.test(l.message))).toBe(true);
  });
});

describe('useAssist relaxation mode', () => {
  it('doubles the monitor interval', async () => {
    saveSettings({ relaxMode: true, captureMs: 500, monitorMode: 'app' });
    const { result } = renderHook(() => useAssist());
    expect(result.current.intervalMs).toBe(1000);
    act(() => result.current.setSettings((s) => ({ ...s, relaxMode: false })));
    expect(result.current.intervalMs).toBe(500);
  });

  it('raises a break reminder every breakMinutes while on', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    saveSettings({ relaxMode: true, breakMinutes: 5 });
    const { result } = renderHook(() => useAssist());
    await act(async () => {});
    expect(result.current.notifications.some((n) => n.category === 'relax')).toBe(false);
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(result.current.notifications.find((n) => n.category === 'relax')).toMatchObject({ severity: 'info', source: 'Relaxation' });
  });
});
