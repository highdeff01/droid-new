import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry } from './types.js';
import { INVOCATION_LIMIT, createRegistry, type InvocationRecord, type Params, type Registry, type Requester } from './capabilities.js';
import { assistCapabilities, type AssistOps } from './assist-capabilities.js';
import { MAIN_APP_POLL_MS, serveMainApp } from './main-app-bridge.js';

type AddLog = (from: string, message: string, tone?: LogEntry['tone']) => void;

const USER: Requester = { kind: 'user' };
const paramText = (p: Params) => (Object.keys(p).length ? ` ${JSON.stringify(p)}` : '');

/**
 * The engine's capability registry over `ops` (read at invoke time, so the latest engine state is
 * used): every invocation is kept (newest first) and logged with its requester, parameters and
 * result. While a bridge is configured, the main Droid app's mailbox is served every MAIN_APP_POLL_MS.
 */
export function useCapabilities(ops: AssistOps, addLog: AddLog, bridge: { url: string; token: string }) {
  const opsRef = useRef(ops);
  opsRef.current = ops;
  const [invocations, setInvocations] = useState<InvocationRecord[]>([]);
  const [registry] = useState<Registry>(() => createRegistry(assistCapabilities(() => opsRef.current), (r) => {
    setInvocations((list) => [r, ...list].slice(0, INVOCATION_LIMIT));
    addLog('Capabilities', `${r.requester} → ${r.id}${paramText(r.params)}: ${r.ok ? '' : 'REFUSED/FAILED — '}${r.result}`, r.ok ? 'info' : 'warn');
  }));

  /** Invokes one capability; buttons call it as the user, the AI and agents name themselves. */
  const invoke = useCallback((id: string, params: Params = {}, requester: Requester = USER) => registry.invoke(id, params, requester), [registry]);

  useEffect(() => {
    if (!bridge.url) return undefined;
    const tick = setInterval(() => void serveMainApp(bridge.url, bridge.token, opsRef.current.status(), registry), MAIN_APP_POLL_MS);
    return () => clearInterval(tick);
  }, [bridge.url, bridge.token, registry]);

  return { registry, invocations, invoke };
}
