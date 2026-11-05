/**
 * The plugin/extension system: a manifest schema, a sandboxed lifecycle, and registration into the
 * capability registry so the AI can invoke a plugin's features exactly like built-ins. A plugin never
 * touches app state directly — it only receives a narrow API that collects registrations, so a broken
 * plugin fails alone and is dropped.
 */
import type { Capability, CapabilityResult, Caller, Params, ParamSpec } from './capability-registry.js';

/** A capability a plugin wants to register; its `id` is local and gets namespaced by the host. */
export interface PluginCapabilitySpec {
  id: string;
  description: string;
  params: ParamSpec[];
  access?: 'all' | 'main';
  invoke: (params: Params, caller: Caller) => Promise<CapabilityResult>;
}

/** A slash command a plugin adds to the command parser. */
export interface PluginCommandSpec {
  name: string;
  usage: string;
  /** The command's handler, called with the text after the command name. */
  run: (target: string) => void | Promise<void>;
}

/** A panel type a plugin adds; the host renders it where the panel board lists plugin panels. */
export interface PluginPanelSpec {
  id: string;
  title: string;
  render: () => unknown;
}

/** A plugin's manifest: who it is and what it declares. */
export interface PluginManifest {
  /** Stable id, lowercase letters/digits with `-` or `.`, e.g. `acme.notes`. */
  id: string;
  name: string;
  /** Semantic version, e.g. `1.0.0`. */
  version: string;
  description: string;
  capabilities?: PluginCapabilitySpec[];
  commands?: PluginCommandSpec[];
  panels?: PluginPanelSpec[];
}

/** What a plugin receives while active: registration and logging, and nothing else. */
export interface PluginApi {
  registerCapability(spec: PluginCapabilitySpec): void;
  registerCommand(spec: PluginCommandSpec): void;
  registerPanel(spec: PluginPanelSpec): void;
  log(message: string): void;
}

/** A loaded plugin module: its manifest and its lifecycle hooks. */
export interface PluginModule {
  manifest: PluginManifest;
  /** Runs on load; may be async. A throw marks the plugin failed and drops its registrations. */
  activate(api: PluginApi): void | Promise<void>;
  /** Runs on unload; best-effort, never fatal. */
  deactivate?(): void | Promise<void>;
}

/** Where a plugin is in its lifecycle. */
export type PluginStatus = 'active' | 'failed' | 'disabled';

/** One plugin the host knows about. */
export interface PluginRecord {
  manifest: PluginManifest;
  status: PluginStatus;
  /** The failure reason when `status` is 'failed', else empty. */
  error: string;
  /** Capabilities the plugin registered (ids already namespaced), when active. */
  capabilityIds: string[];
  commandNames: string[];
  panelIds: string[];
}

/** A registered plugin command, ready for the parser. */
export interface RegisteredCommand {
  pluginId: string;
  name: string;
  usage: string;
  run: (target: string) => void | Promise<void>;
}

/** A registered plugin panel. */
export interface RegisteredPanel {
  pluginId: string;
  id: string;
  title: string;
  render: () => unknown;
}

const ID_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Why `manifest` is not usable, or null. */
export function manifestError(manifest: PluginManifest): string | null {
  if (!manifest || typeof manifest !== 'object') return 'manifest is not an object';
  if (!ID_RE.test(manifest.id ?? '')) return `invalid id "${manifest.id ?? ''}" — use lowercase letters, digits, "-" or "."`;
  if (!manifest.name?.trim()) return 'name is required';
  if (!VERSION_RE.test(manifest.version ?? '')) return `invalid version "${manifest.version ?? ''}" — use semver, e.g. 1.0.0`;
  if (typeof manifest.description !== 'string') return 'description is required';
  for (const cap of manifest.capabilities ?? []) {
    if (!cap.id || !ID_RE.test(cap.id)) return `capability "${cap.id ?? ''}" has an invalid id`;
    if (typeof cap.invoke !== 'function') return `capability "${cap.id}" has no invoke`;
    if (!cap.description?.trim()) return `capability "${cap.id}" needs a description`;
    if (cap.access && cap.access !== 'all' && cap.access !== 'main') return `capability "${cap.id}" has an invalid access`;
  }
  for (const cmd of manifest.commands ?? []) {
    if (!/^[a-z][a-z0-9]*$/.test(cmd.name ?? '')) return `command "${cmd.name ?? ''}" must be a single lowercase word`;
    if (typeof cmd.run !== 'function') return `command "${cmd.name}" has no run`;
  }
  for (const panel of manifest.panels ?? []) {
    if (!panel.id || !ID_RE.test(panel.id)) return `panel "${panel.id ?? ''}" has an invalid id`;
    if (typeof panel.render !== 'function') return `panel "${panel.id}" has no render`;
  }
  return null;
}

/** The namespaced capability id of a plugin capability: `plugin.<pluginId>.<capId>`. */
export const capabilityIdOf = (pluginId: string, capId: string): string => `plugin.${pluginId}.${capId}`;

/** The host that loads plugins and collects what they register. */
export interface PluginHost {
  /** Loads a plugin module: validates, activates under the sandbox, and records the outcome. */
  load(module: PluginModule): Promise<PluginRecord>;
  /** Unloads a plugin: runs its deactivate and drops its registrations. */
  unload(id: string): Promise<void>;
  /** Every plugin, in load order. */
  plugins(): PluginRecord[];
  /** The registered capabilities, ready for `createRegistry`. */
  capabilities(): Capability[];
  /** The registered commands. */
  commands(): RegisteredCommand[];
  /** The registered panels. */
  panels(): RegisteredPanel[];
  /** Lines a plugin logged, newest last. */
  logs(): string[];
}

/** A fresh plugin host. */
export function createPluginHost(): PluginHost {
  const records: PluginRecord[] = [];
  const byId = new Map<string, PluginRecord>();
  const caps: Capability[] = [];
  const cmds: RegisteredCommand[] = [];
  const panels: RegisteredPanel[] = [];
  const logs: string[] = [];

  /** Drops everything one plugin registered (used on unload and on a failed activate). */
  const dropRegistrations = (id: string) => {
    for (let i = caps.length - 1; i >= 0; i--) if (caps[i].id.startsWith(`plugin.${id}.`)) caps.splice(i, 1);
    for (let i = cmds.length - 1; i >= 0; i--) if (cmds[i].pluginId === id) cmds.splice(i, 1);
    for (let i = panels.length - 1; i >= 0; i--) if (panels[i].pluginId === id) panels.splice(i, 1);
  };

  const load = async (module: PluginModule): Promise<PluginRecord> => {
    const manifest = module.manifest;
    const error = manifestError(manifest) ?? (typeof module.activate !== 'function' ? 'activate is required' : null);
    if (error) {
      const record: PluginRecord = { manifest, status: 'failed', error, capabilityIds: [], commandNames: [], panelIds: [] };
      if (byId.has(manifest?.id)) Object.assign(byId.get(manifest.id)!, record);
      else { records.push(record); byId.set(manifest?.id ?? '', record); }
      return record;
    }
    if (byId.has(manifest.id)) {
      // A reload replaces the previous load: drop its registrations first.
      await unload(manifest.id);
      records.splice(records.findIndex((r) => r.manifest.id === manifest.id), 1);
      byId.delete(manifest.id);
    }

    const record: PluginRecord = { manifest, status: 'active', error: '', capabilityIds: [], commandNames: [], panelIds: [] };
    records.push(record);
    byId.set(manifest.id, record);

    /** The sandboxed API: it enforces namespacing and records what the plugin declares. */
    const api: PluginApi = {
      registerCapability: (spec) => {
        const id = capabilityIdOf(manifest.id, spec.id);
        if (caps.some((c) => c.id === id)) throw new Error(`capability "${id}" is already registered`);
        caps.push({ id, description: spec.description, params: spec.params ?? [], access: spec.access ?? 'all', invoke: spec.invoke });
        record.capabilityIds.push(id);
      },
      registerCommand: (spec) => {
        if (cmds.some((c) => c.name === spec.name)) throw new Error(`command "/${spec.name}" is already registered`);
        cmds.push({ pluginId: manifest.id, name: spec.name, usage: spec.usage, run: spec.run });
        record.commandNames.push(spec.name);
      },
      registerPanel: (spec) => {
        const id = `${manifest.id}.${spec.id}`;
        if (panels.some((p) => p.id === id)) throw new Error(`panel "${id}" is already registered`);
        panels.push({ pluginId: manifest.id, id, title: spec.title, render: spec.render });
        record.panelIds.push(id);
      },
      log: (message) => logs.push(`[${manifest.id}] ${message}`),
    };

    try {
      await module.activate(api);
    } catch (e) {
      record.status = 'failed';
      record.error = e instanceof Error ? e.message : String(e);
      dropRegistrations(manifest.id);
      record.capabilityIds = [];
      record.commandNames = [];
      record.panelIds = [];
    }
    return record;
  };

  const unload = async (id: string) => {
    const record = byId.get(id);
    dropRegistrations(id);
    if (record) {
      record.status = 'disabled';
      record.capabilityIds = [];
      record.commandNames = [];
      record.panelIds = [];
    }
  };

  return { load, unload, plugins: () => [...records], capabilities: () => [...caps], commands: () => [...cmds], panels: () => [...panels], logs: () => [...logs] };
}
