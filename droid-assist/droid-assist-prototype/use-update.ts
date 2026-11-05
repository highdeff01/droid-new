import { useCallback, useEffect, useRef, useState } from 'react';
import type { NativeUpdateApi, UpdateOutcome, UpdateStatus } from './electron/update-api.js';

declare global {
  interface Window {
    /** Exposed by the Electron preload: check GitHub and update the app. Undefined in a plain browser. */
    droidUpdate?: NativeUpdateApi;
  }
}

/** Log source of every update line. */
export const UPDATE_SOURCE = 'Update';

/** What the update flow is doing. */
export type UpdatePhase = 'unsupported' | 'idle' | 'checking' | 'available' | 'updating' | 'failed';

/** What the Settings → Updates panel and the log show. */
export interface UpdateView {
  phase: UpdatePhase;
  /** Commits on the tracked remote the local branch does not have. */
  behind: number;
  /** Subject of the newest remote commit, when known. */
  latest: string;
  /** This app's version. */
  version: string;
  /** One line describing the state. */
  message: string;
}

/** The starting view: unsupported in a browser, otherwise idle. */
export const initialUpdateView = (supported: boolean): UpdateView => ({
  phase: supported ? 'idle' : 'unsupported',
  behind: 0,
  latest: '',
  version: '',
  message: supported ? 'Not checked yet' : 'Updates are only available in the packaged app',
});

/** The view after a check. */
export const viewAfterCheck = (status: UpdateStatus): UpdateView => ({
  phase: status.ok ? (status.behind ? 'available' : 'idle') : 'failed',
  behind: status.behind,
  latest: status.latest,
  version: status.version,
  message: status.message,
});

/** The one-line status text. */
export const updateText = (v: UpdateView): string => {
  switch (v.phase) {
    case 'unsupported': return v.message;
    case 'checking': return 'Checking GitHub for a newer build…';
    case 'updating': return 'Pulling, reinstalling and rebuilding…';
    case 'available': return `Update available: ${v.message}`;
    case 'failed': return `Update failed: ${v.message}`;
    default: return v.version ? `Up to date (v${v.version})` : v.message;
  }
};

/**
 * Update-on-start: when `enabled` and the native API is present, checks GitHub once and, if the
 * branch is behind, pulls/reinstalls/rebuilds and relaunches. `checkNow` and `updateNow` are the
 * manual controls the Settings panel wires to its buttons.
 */
export function useAutoUpdate(enabled: boolean, log: (message: string, tone?: 'info' | 'warn' | 'error') => void) {
  const [view, setView] = useState<UpdateView>(() => initialUpdateView(!!window.droidUpdate));
  const running = useRef(false);
  const logRef = useRef(log);
  logRef.current = log;

  const checkNow = useCallback(async (): Promise<UpdateStatus | null> => {
    const api = window.droidUpdate;
    if (!api) {
      setView(initialUpdateView(false));
      return null;
    }
    setView((v) => ({ ...v, phase: 'checking', message: 'Checking GitHub for a newer build…' }));
    const status = await api.check();
    setView(viewAfterCheck(status));
    logRef.current(status.behind ? `Update available: ${status.message}` : `Up to date: ${status.message}`, status.ok ? 'info' : 'warn');
    return status;
  }, []);

  const updateNow = useCallback(async (): Promise<UpdateOutcome | null> => {
    const api = window.droidUpdate;
    if (!api || running.current) return null;
    running.current = true;
    setView((v) => ({ ...v, phase: 'updating', message: 'Pulling, reinstalling and rebuilding…' }));
    const outcome = await api.run();
    running.current = false;
    setView((v) => ({ ...v, phase: outcome.ok ? 'idle' : 'failed', message: outcome.message }));
    logRef.current(outcome.ok ? `Updated — ${outcome.message}` : `Update failed — ${outcome.message}`, outcome.ok ? 'info' : 'error');
    return outcome;
  }, []);

  useEffect(() => {
    if (!enabled || !window.droidUpdate) return;
    void checkNow().then((status) => {
      if (status?.ok && status.behind) void updateNow();
    });
  }, [enabled, checkNow, updateNow]);

  return { view, checkNow, updateNow };
}
