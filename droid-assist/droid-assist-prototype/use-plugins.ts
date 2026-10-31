import { useCallback, useMemo, useRef, useState } from 'react';
import { createPluginHost, type PluginHost, type PluginModule, type PluginRecord, type RegisteredCommand, type RegisteredPanel } from './plugins.js';
import type { Capability } from './capability-registry.js';

/** What the engine exposes about plugins. */
export interface PluginApi {
  /** Every plugin the host knows about, in load order. */
  plugins: PluginRecord[];
  /** The capabilities plugins registered, ready to join the main registry. */
  capabilities: Capability[];
  /** The commands plugins registered. */
  commands: RegisteredCommand[];
  /** The panels plugins registered. */
  panels: RegisteredPanel[];
  /** Lines plugins logged, newest last. */
  logs: string[];
  /** Loads a plugin module; a failure is recorded, never thrown. */
  load(module: PluginModule): Promise<PluginRecord>;
  /** Unloads a plugin by id. */
  unload(id: string): Promise<void>;
  /** The `/name` command a plugin registered, if any. */
  commandFor(text: string): { command: RegisteredCommand; target: string } | null;
}

/**
 * The plugin host of the engine: plugins register capabilities, commands and panels through a narrow
 * sandboxed API. Capabilities join the main registry so the AI invokes them like built-ins; a broken
 * plugin fails alone and its registrations are dropped.
 */
export function usePlugins(log: (message: string, tone?: 'info' | 'warn' | 'error') => void): PluginApi {
  const hostRef = useRef<PluginHost | null>(null);
  hostRef.current ??= createPluginHost();
  const host = hostRef.current;
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const load = useCallback(async (module: PluginModule) => {
    const record = await host.load(module);
    log(`Plugin "${record.manifest?.name ?? record.manifest?.id ?? 'unknown'}" ${record.status}${record.error ? ` — ${record.error}` : ''}`, record.status === 'active' ? 'info' : 'error');
    bump();
    return record;
  }, [host, log, bump]);

  const unload = useCallback(async (id: string) => {
    await host.unload(id);
    log(`Plugin "${id}" unloaded`, 'info');
    bump();
  }, [host, log, bump]);

  const commandFor = useCallback((text: string) => {
    const m = /^\/([a-z][a-z0-9]*)(?:\s+(.*))?$/.exec(text.trim());
    if (!m) return null;
    const command = host.commands().find((c) => c.name === m[1]);
    return command ? { command, target: (m[2] ?? '').trim() } : null;
  }, [host]);

  // Recompute the snapshots whenever a plugin loads or unloads (`version`).
  return useMemo(() => ({
    plugins: host.plugins(),
    capabilities: host.capabilities(),
    commands: host.commands(),
    panels: host.panels(),
    logs: host.logs(),
    load,
    unload,
    commandFor,
  }), [host, load, unload, commandFor, version]);
}
