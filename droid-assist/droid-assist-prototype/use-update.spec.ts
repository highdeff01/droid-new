import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialUpdateView, updateText, useAutoUpdate, viewAfterCheck } from './use-update.js';
import type { NativeUpdateApi, UpdateStatus } from './electron/update-api.js';

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { droidUpdate?: NativeUpdateApi }).droidUpdate;
});

const status = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({ ok: true, behind: 0, latest: '', message: 'Up to date', version: '0.1.0', ...over });

/** Installs a fake native update API on window and returns it. */
function fakeApi(over: Partial<NativeUpdateApi> = {}): NativeUpdateApi {
  const api: NativeUpdateApi = {
    check: vi.fn(async () => status()),
    run: vi.fn(async () => ({ ok: true, message: 'Updated and rebuilt — relaunching', steps: [] })),
    ...over,
  };
  (window as { droidUpdate?: NativeUpdateApi }).droidUpdate = api;
  return api;
}

describe('update view helpers', () => {
  it('starts unsupported without the native API and idle with it', () => {
    expect(initialUpdateView(false).phase).toBe('unsupported');
    expect(initialUpdateView(true).phase).toBe('idle');
  });

  it('maps a check result to the view', () => {
    expect(viewAfterCheck(status({ behind: 2, latest: 'Add voice', message: '2 new commits' }))).toMatchObject({ phase: 'available', behind: 2, latest: 'Add voice' });
    expect(viewAfterCheck(status())).toMatchObject({ phase: 'idle', behind: 0 });
    expect(viewAfterCheck(status({ ok: false, message: 'offline' }))).toMatchObject({ phase: 'failed' });
  });

  it('writes a plain status line per phase', () => {
    expect(updateText(initialUpdateView(false))).toContain('packaged app');
    expect(updateText({ phase: 'available', behind: 1, latest: 'x', version: '1', message: '1 new commit' })).toContain('Update available');
    expect(updateText({ phase: 'idle', behind: 0, latest: '', version: '0.1.0', message: '' })).toBe('Up to date (v0.1.0)');
    expect(updateText({ phase: 'failed', behind: 0, latest: '', version: '1', message: 'boom' })).toContain('Update failed: boom');
  });
});

describe('useAutoUpdate', () => {
  it('checks and updates on start when the branch is behind and auto-update is on', async () => {
    const api = fakeApi({ check: vi.fn(async () => status({ behind: 1, latest: 'Add voice', message: '1 new commit' })) });
    const log = vi.fn();
    const { result } = renderHook(() => useAutoUpdate(true, log));
    await waitFor(() => expect(api.run).toHaveBeenCalled());
    await waitFor(() => expect(result.current.view.phase).toBe('idle'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Update available'), 'info');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Updated'), 'info');
  });

  it('does not update on start when it is up to date', async () => {
    const api = fakeApi();
    renderHook(() => useAutoUpdate(true, vi.fn()));
    await waitFor(() => expect(api.check).toHaveBeenCalled());
    expect(api.run).not.toHaveBeenCalled();
  });

  it('does not touch the native API when the toggle is off', async () => {
    const api = fakeApi();
    renderHook(() => useAutoUpdate(false, vi.fn()));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.check).not.toHaveBeenCalled();
  });

  it('does not call the native API without it (plain browser)', async () => {
    const log = vi.fn();
    const { result } = renderHook(() => useAutoUpdate(true, log));
    await act(async () => { await result.current.checkNow(); });
    expect(result.current.view.phase).toBe('unsupported');
  });

  it('lets the user check and update by hand', async () => {
    const api = fakeApi({ check: vi.fn(async () => status({ behind: 4, latest: 'new', message: '4 new commits' })) });
    const log = vi.fn();
    const { result } = renderHook(() => useAutoUpdate(false, log));
    await act(async () => { await result.current.checkNow(); });
    expect(result.current.view).toMatchObject({ phase: 'available', behind: 4 });
    await act(async () => { await result.current.updateNow(); });
    expect(api.run).toHaveBeenCalled();
    expect(result.current.view.phase).toBe('idle');
  });

  it('surfaces a failed update honestly', async () => {
    const api = fakeApi({
      check: vi.fn(async () => status({ behind: 1, message: '1 new commit' })),
      run: vi.fn(async () => ({ ok: false, message: 'Update stopped at build — tsc error', steps: [] })),
    });
    const log = vi.fn();
    const { result } = renderHook(() => useAutoUpdate(false, log));
    await act(async () => { await result.current.updateNow(); });
    expect(api.run).toHaveBeenCalled();
    expect(result.current.view.phase).toBe('failed');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Update failed'), 'error');
  });
});
