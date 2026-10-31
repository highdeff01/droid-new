import { describe, expect, it, vi } from 'vitest';
import { capabilityIdOf, createPluginHost, manifestError, type PluginModule } from './plugins.js';
import { createRegistry, invokeCapability } from './capability-registry.js';

const base = (over: Partial<PluginModule['manifest']> = {}, activate?: PluginModule['activate']): PluginModule => ({
  manifest: { id: 'acme.tools', name: 'Acme Tools', version: '1.2.0', description: 'Tools', ...over },
  activate: activate ?? (() => undefined),
});

describe('manifestError', () => {
  it('accepts a well-formed manifest', () => {
    expect(manifestError(base().manifest)).toBeNull();
  });

  it('rejects a bad id, missing name, bad version and missing description', () => {
    expect(manifestError(base({ id: 'Bad Id' }).manifest)).toContain('invalid id');
    expect(manifestError(base({ name: ' ' }).manifest)).toContain('name is required');
    expect(manifestError(base({ version: '1.0' }).manifest)).toContain('invalid version');
    expect(manifestError(base({ description: undefined as unknown as string }).manifest)).toContain('description');
  });

  it('rejects a capability without an invoke, a command with no run and a bad panel', () => {
    expect(manifestError(base({ capabilities: [{ id: 'x', description: 'd', params: [], invoke: undefined as never }] }).manifest)).toContain('no invoke');
    expect(manifestError(base({ commands: [{ name: 'note', usage: '', run: undefined as never }] }).manifest)).toContain('no run');
    expect(manifestError(base({ commands: [{ name: 'Two Words', usage: '', run: () => undefined }] }).manifest)).toContain('single lowercase word');
    expect(manifestError(base({ panels: [{ id: 'p', title: 't', render: undefined as never }] }).manifest)).toContain('no render');
  });
});

describe('createPluginHost', () => {
  it('activates a plugin and records what it registered, namespacing capability ids', async () => {
    const host = createPluginHost();
    const module = base({}, (api) => {
      api.registerCapability({ id: 'ping', description: 'ping', params: [], invoke: async () => ({ ok: true, message: 'pong' }) });
      api.registerCommand({ name: 'ping', usage: 'Usage: /ping', run: () => undefined });
      api.registerPanel({ id: 'main', title: 'Ping', render: () => null });
    });
    const record = await host.load(module);
    expect(record.status).toBe('active');
    expect(record.capabilityIds).toEqual([capabilityIdOf('acme.tools', 'ping')]);
    expect(record.commandNames).toEqual(['ping']);
    expect(record.panelIds).toEqual(['acme.tools.main']);
    expect(host.capabilities().map((c) => c.id)).toEqual(['plugin.acme.tools.ping']);
  });

  it('lets a registered capability run through the main registry like a built-in', async () => {
    const host = createPluginHost();
    await host.load(base({}, (api) => {
      api.registerCapability({
        id: 'echo', description: 'echo', params: [{ name: 'text', type: 'string', required: true, description: 'text' }],
        invoke: async (params) => ({ ok: true, message: `echo ${params.text}` }),
      });
    }));
    const reg = createRegistry(host.capabilities());
    const result = await invokeCapability(reg, { kind: 'main' }, 'plugin.acme.tools.echo', { text: 'hi' }, () => true);
    expect(result).toEqual({ ok: true, message: 'echo hi' });
  });

  it('refuses a duplicate capability id from a second plugin load', async () => {
    const host = createPluginHost();
    const module = base({}, (api) => api.registerCapability({ id: 'ping', description: 'p', params: [], invoke: async () => ({ ok: true, message: '' }) }));
    await host.load(module);
    // Reloading the same plugin drops the old registrations first, so it does not collide.
    const again = await host.load(module);
    expect(again.status).toBe('active');
    expect(host.capabilities()).toHaveLength(1);
  });

  it('fails a plugin that throws on activate, and drops what it had registered', async () => {
    const host = createPluginHost();
    const record = await host.load(base({}, (api) => {
      api.registerCapability({ id: 'x', description: 'x', params: [], invoke: async () => ({ ok: true, message: '' }) });
      throw new Error('boom on activate');
    }));
    expect(record.status).toBe('failed');
    expect(record.error).toContain('boom on activate');
    expect(host.capabilities()).toHaveLength(0);
    expect(record.capabilityIds).toEqual([]);
  });

  it('fails a plugin with a bad manifest without running it', async () => {
    const host = createPluginHost();
    const activate = vi.fn();
    const record = await host.load(base({ id: 'BAD' }, activate));
    expect(record.status).toBe('failed');
    expect(activate).not.toHaveBeenCalled();
  });

  it('unloads a plugin: deactivate is not required, registrations are dropped', async () => {
    const host = createPluginHost();
    await host.load(base({}, (api) => api.registerCommand({ name: 'note', usage: '', run: () => undefined })));
    expect(host.commands()).toHaveLength(1);
    await host.unload('acme.tools');
    expect(host.commands()).toHaveLength(0);
    expect(host.plugins()[0].status).toBe('disabled');
  });

  it('refuses two plugins registering the same command name', async () => {
    const host = createPluginHost();
    await host.load(base({ id: 'a.one' }, (api) => api.registerCommand({ name: 'dup', usage: '', run: () => undefined })));
    const record = await host.load(base({ id: 'b.two' }, (api) => api.registerCommand({ name: 'dup', usage: '', run: () => undefined })));
    expect(record.status).toBe('failed');
    expect(record.error).toContain('already registered');
    expect(host.commands()).toHaveLength(1);
  });

  it('collects plugin log lines with the plugin id', async () => {
    const host = createPluginHost();
    await host.load(base({}, (api) => api.log('hello')));
    expect(host.logs()).toEqual(['[acme.tools] hello']);
  });
});
