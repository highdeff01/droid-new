import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialPhoneView, phoneSnapshot, usePhoneCompanion, type PhoneDeps } from './use-phone.js';
import type { PhoneAction, PhoneNativeApi } from './electron/phone-api.js';

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { droidPhone?: PhoneNativeApi }).droidPhone;
});

const deps = (over: Partial<PhoneDeps> = {}): PhoneDeps => ({
  apps: () => [{ name: 'droid-new', status: 'connected', detail: 'up' }],
  approvals: () => [{ id: 'a1', title: 'Delete the folder', detail: 'Aggressive' }],
  workflows: () => [{ id: 'w1', name: 'Shopping run' }],
  driving: () => 'droid-new',
  frame: () => 'data:image/jpeg;base64,AAAA',
  approve: vi.fn(),
  reject: vi.fn(),
  runWorkflow: vi.fn(),
  log: vi.fn(),
  ...over,
});

/** Installs a fake native phone API on window and returns it with a trigger for actions. */
function fakeApi(over: Partial<PhoneNativeApi> = {}) {
  let fire: ((a: PhoneAction) => void) | null = null;
  const api: PhoneNativeApi = {
    start: vi.fn(async () => ({ url: 'http://10.0.0.5:8788/?token=t', error: '' })),
    push: vi.fn(),
    stop: vi.fn(),
    onAction: vi.fn((h) => { fire = h; return () => { fire = null; }; }),
    ...over,
  };
  (window as { droidPhone?: PhoneNativeApi }).droidPhone = api;
  return { api, trigger: (a: PhoneAction) => fire?.(a) };
}

describe('phoneSnapshot', () => {
  it('builds the snapshot from the engine state', () => {
    const snap = phoneSnapshot(deps());
    expect(snap.apps).toHaveLength(1);
    expect(snap.approvals[0].id).toBe('a1');
    expect(snap.workflows[0].id).toBe('w1');
    expect(snap.driving).toBe('droid-new');
    expect(snap.frame).toContain('base64');
    expect(typeof snap.updatedAt).toBe('number');
  });
});

describe('initialPhoneView', () => {
  it('is unsupported without the native API and stopped with it', () => {
    expect(initialPhoneView(false)).toMatchObject({ supported: false, running: false });
    expect(initialPhoneView(true).message).toBe('Not running');
  });
});

describe('usePhoneCompanion', () => {
  it('starts the companion and reports where the phone connects', async () => {
    const { api } = fakeApi();
    const log = vi.fn();
    const { result } = renderHook(() => usePhoneCompanion(deps({ log })));
    await act(async () => { await result.current.start({ host: '0.0.0.0', port: 8788, token: 't' }); });
    expect(api.start).toHaveBeenCalledWith({ host: '0.0.0.0', port: 8788, token: 't' });
    expect(result.current.view.running).toBe(true);
    expect(result.current.view.url).toBe('http://10.0.0.5:8788/?token=t');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('listening'), 'info');
  });

  it('reports a failed start honestly', async () => {
    const { api } = fakeApi({ start: vi.fn(async () => ({ url: '', error: 'port in use' })) });
    const log = vi.fn();
    const { result } = renderHook(() => usePhoneCompanion(deps({ log })));
    await act(async () => { await result.current.start({ host: '0.0.0.0', port: 8788, token: '' }); });
    expect(result.current.view.running).toBe(false);
    expect(result.current.view.message).toContain('port in use');
    expect(log).toHaveBeenCalledWith('port in use', 'error');
    expect(api.push).not.toHaveBeenCalled();
  });

  it('routes a phone approval, rejection and workflow run into the engine', async () => {
    const approve = vi.fn(); const reject = vi.fn(); const runWorkflow = vi.fn();
    const { trigger } = fakeApi();
    renderHook(() => usePhoneCompanion(deps({ approve, reject, runWorkflow })));
    await waitFor(() => expect(trigger).toBeTypeOf('function'));
    act(() => { trigger({ kind: 'approve', id: 'a1' }); });
    act(() => { trigger({ kind: 'reject', id: 'a1' }); });
    act(() => { trigger({ kind: 'runWorkflow', id: 'w1' }); });
    expect(approve).toHaveBeenCalledWith('a1');
    expect(reject).toHaveBeenCalledWith('a1');
    expect(runWorkflow).toHaveBeenCalledWith('w1');
  });

  it('pushes the live snapshot to the companion while it is running', async () => {
    vi.useFakeTimers();
    try {
      const { api } = fakeApi();
      const { result } = renderHook(() => usePhoneCompanion(deps()));
      await act(async () => { await result.current.start({ host: '0.0.0.0', port: 8788, token: '' }); });
      act(() => { vi.advanceTimersByTime(1000); });
      expect(api.push).toHaveBeenCalledTimes(1);
      expect((api.push as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ driving: 'droid-new' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops the companion', async () => {
    const { api } = fakeApi();
    const { result } = renderHook(() => usePhoneCompanion(deps()));
    await act(async () => { await result.current.start({ host: '0.0.0.0', port: 8788, token: '' }); });
    act(() => { result.current.stop(); });
    expect(api.stop).toHaveBeenCalled();
    expect(result.current.view.running).toBe(false);
  });
});
