import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AssistEngine } from './use-assist.js';
import type { AssistNotification } from './notifications.js';
import { DEFAULT_AUTO_ACT } from './notifications.js';
import type { SystemInfo } from './electron/system-api.js';
import { NotificationsPanel } from './notifications-panel.js';
import { SystemPanel } from './system-panel.js';
import { RecoverySettings, RelaxSettings } from './relax-recovery-settings.js';

const info: SystemInfo = {
  source: 'electron', os: 'Windows 11', arch: 'x64', cpu: { model: 'Ryzen 7', cores: 8 }, memory: { totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3 },
  displays: [{ label: 'Display 1', width: 2560, height: 1440, primary: true }], uptimeSec: 3 * 3600 + 120, uptimeOf: 'system', disk: { freeBytes: 50 * 1024 ** 3, totalBytes: 500 * 1024 ** 3 },
};

const notif = (over: Partial<AssistNotification>): AssistNotification => ({ id: 'n1', time: Date.now(), source: 'Suggestions', category: 'suggestion', severity: 'info', title: 'You usually open YouTube around now', read: false, ...over });

const engine = (over: Partial<AssistEngine> = {}) => ({
  settings: { relaxMode: false, breakMinutes: 45, systemRefreshSec: 30, notifyAutoAct: DEFAULT_AUTO_ACT, systemFolders: [] },
  setSettings: vi.fn(),
  notifications: [],
  runs: [{ id: 'r1', time: Date.now(), session: 's', goal: 'open Notepad', attempted: 1, succeeded: 1, durationMs: 900, outcome: 'success' }],
  system: { info, folders: [{ path: 'C:\\Docs', sizeBytes: 2048, files: 3, folders: 1, recent: [{ path: 'a.txt', size: 10, modified: 0 }], truncated: false }], refreshedAt: Date.now(), refresh: vi.fn(async () => info), addFolder: vi.fn(async () => null), removeFolder: vi.fn() },
  recovery: { time: 0, corrupt: [], lastGoodAt: null, prunedFrames: 0 },
  restoreLastGood: vi.fn(() => ({ ok: false, message: 'none' })),
  actOnNotification: vi.fn(async () => undefined), markRead: vi.fn(), markAllRead: vi.fn(), clearNotifications: vi.fn(), refreshSuggestions: vi.fn(async () => undefined),
  ...over,
}) as unknown as AssistEngine;

afterEach(cleanup);

describe('SystemPanel', () => {
  it('shows computer info, folder specs, recent operations and refreshes on demand', () => {
    const e = engine();
    render(<SystemPanel engine={e} />);
    const panel = screen.getByRole('region', { name: 'System' });
    expect(panel.textContent).toContain('Windows 11');
    expect(panel.textContent).toContain('8 core(s)');
    expect(panel.textContent).toContain('2560×1440 (primary)');
    expect(panel.textContent).toContain('3h 2m');
    expect(panel.textContent).toContain('C:\\Docs');
    expect(panel.textContent).toContain('3 file(s)');
    expect(panel.textContent).toContain('open Notepad');
    expect(screen.getByLabelText('Current time').textContent).toMatch(/\d/);
    fireEvent.click(screen.getByText('Refresh'));
    expect(e.system.refresh).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Stop watching C:\\Docs'));
    expect(e.system.removeFolder).toHaveBeenCalledWith('C:\\Docs');
  });
});

describe('NotificationsPanel', () => {
  it('lists notifications with their proposed action and runs it on click', () => {
    const e = engine({ notifications: [notif({ action: { kind: 'open_app', text: 'YouTube' } })] });
    render(<NotificationsPanel engine={e} />);
    expect(screen.getByRole('region', { name: 'Notifications' }).textContent).toContain('1 unread');
    fireEvent.click(screen.getByText('Open YouTube'));
    expect(e.actOnNotification).toHaveBeenCalledWith('n1');
  });

  it('toggles auto-act for one category, all off by default', () => {
    const e = engine();
    render(<NotificationsPanel engine={e} />);
    const box = screen.getByLabelText('Auto-act on AI suggestions') as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(e.setSettings).toHaveBeenCalledWith(expect.objectContaining({ notifyAutoAct: { ...DEFAULT_AUTO_ACT, suggestion: true } }));
  });

  it('dims info notifications in relaxation mode but not warnings', () => {
    const e = engine({ settings: { ...engine().settings, relaxMode: true }, notifications: [notif({ id: 'a', title: 'info one' }), notif({ id: 'b', severity: 'warning', title: 'warn one' })] });
    render(<NotificationsPanel engine={e} />);
    expect((screen.getByText('info one').closest('li') as HTMLElement).style.opacity).toBe('0.5');
    expect((screen.getByText('warn one').closest('li') as HTMLElement).style.opacity).toBe('1');
  });
});

describe('Relax and recovery settings', () => {
  it('turns relaxation mode on', () => {
    const e = engine();
    render(<RelaxSettings engine={e} />);
    fireEvent.click(screen.getByLabelText('Relaxation mode'));
    expect(e.setSettings).toHaveBeenCalledWith(expect.objectContaining({ relaxMode: true }));
  });

  it('restores the last good export after confirmation', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const e = engine();
    render(<RecoverySettings engine={e} />);
    fireEvent.click(screen.getByText('Restore last good export'));
    expect(e.restoreLastGood).toHaveBeenCalled();
  });
});
