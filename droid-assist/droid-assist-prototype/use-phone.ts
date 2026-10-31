import { useEffect, useMemo, useRef, useState } from 'react';
import type { PhoneAction, PhoneNativeApi, PhonePush, PhoneStartResult } from './electron/phone-api.js';

declare global {
  interface Window {
    /** Exposed by the Electron preload: serve the phone companion. Undefined in a plain browser. */
    droidPhone?: PhoneNativeApi;
  }
}

/** The live state of the phone companion. */
export interface PhoneView {
  /** Whether the companion can run here (the packaged app, not a browser). */
  supported: boolean;
  /** Whether it is listening right now. */
  running: boolean;
  /** The URL a phone on the same network opens, when running. */
  url: string;
  /** One line describing the state, or the failure reason. */
  message: string;
}

/** The starting view: unsupported in a browser, otherwise stopped. */
export const initialPhoneView = (supported: boolean): PhoneView => ({
  supported,
  running: false,
  url: '',
  message: supported ? 'Not running' : 'The phone companion is only available in the packaged app',
});

/** What the phone companion needs from the engine. */
export interface PhoneDeps {
  /** The status of both apps. */
  apps(): PhonePush['apps'];
  /** The queued approvals, with the title and detail a phone shows. */
  approvals(): PhonePush['approvals'];
  /** The saved workflows a phone can trigger. */
  workflows(): PhonePush['workflows'];
  /** Which app currently owns execution. */
  driving(): string;
  /** The latest screen frame as a JPEG data URL, or ''. */
  frame(): string;
  /** Approves a queued approval by id (the same path the desktop uses). */
  approve(id: string): void;
  /** Rejects a queued approval by id. */
  reject(id: string): void;
  /** Runs a saved workflow by id. */
  runWorkflow(id: string): void;
  /** Logs one line about the companion. */
  log(message: string, tone?: 'info' | 'warn' | 'error'): void;
}

/** The snapshot the companion serves, built from the engine's live state. */
export function phoneSnapshot(deps: PhoneDeps): PhonePush {
  return { apps: deps.apps(), approvals: deps.approvals(), workflows: deps.workflows(), driving: deps.driving(), frame: deps.frame(), updatedAt: Date.now() };
}

/**
 * The phone companion: a small web client the bridge serves so a phone on the same network can see
 * both apps' status, answer queued approvals, trigger saved workflows and watch the live screen.
 * The snapshot is pushed from the engine's own state — the companion never holds a second copy.
 */
export function usePhoneCompanion(deps: PhoneDeps) {
  const native = typeof window === 'undefined' ? undefined : window.droidPhone;
  const [view, setView] = useState<PhoneView>(() => initialPhoneView(!!native));
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    if (!native) return undefined;
    // Actions the phone triggers go through the same engine paths as the desktop.
    const off = native.onAction((action: PhoneAction) => {
      if (action.kind === 'approve') depsRef.current.approve(action.id);
      else if (action.kind === 'reject') depsRef.current.reject(action.id);
      else depsRef.current.runWorkflow(action.id);
      depsRef.current.log(`Phone: ${action.kind} ${action.id}`, 'info');
    });
    // Push a fresh snapshot every second while the companion is running.
    const timer = setInterval(() => { if (viewRef.current.running) native.push(phoneSnapshot(depsRef.current)); }, 1000);
    return () => { off(); clearInterval(timer); };
  }, [native]);

  const start = async (options: { host: string; port: number; token: string }) => {
    if (!native) return;
    depsRef.current.log('Starting the phone companion…', 'info');
    const result: PhoneStartResult = await native.start(options);
    if (result.error) {
      setView((v) => ({ ...v, running: false, url: '', message: result.error }));
      depsRef.current.log(result.error, 'error');
      return;
    }
    setView((v) => ({ ...v, running: true, url: result.url, message: 'Listening' }));
    depsRef.current.log(`Phone companion listening at ${result.url}`, 'info');
  };

  const stop = () => {
    if (!native) return;
    native.stop();
    setView((v) => ({ ...v, running: false, url: '', message: 'Stopped' }));
    depsRef.current.log('Phone companion stopped', 'info');
  };

  return useMemo(() => ({ view, start, stop }), [view]);
}

/** The phone companion the engine exposes. */
export type PhoneCompanionHook = ReturnType<typeof usePhoneCompanion>;
