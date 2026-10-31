import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginsPanel } from './plugins-panel.js';
import { examplePlugin } from './example-plugin.js';
import type { AssistEngine } from './use-assist.js';
import type { PluginRecord } from './plugins.js';

afterEach(cleanup);

const record = (over: Partial<PluginRecord> = {}): PluginRecord => ({
  manifest: examplePlugin.manifest,
  status: 'active',
  error: '',
  capabilityIds: ['plugin.example.notes.append'],
  commandNames: ['note'],
  panelIds: ['example.notes.notes'],
  ...over,
});

/** A fake engine carrying only what PluginsPanel reads. */
function fakeEngine(over: Partial<AssistEngine['plugins']> = {}) {
  const load = vi.fn(async () => record());
  const unload = vi.fn(async () => undefined);
  const plugins = { plugins: [], capabilities: [], commands: [], panels: [], logs: [], load, unload, commandFor: () => null, ...over } as AssistEngine['plugins'];
  return { engine: { plugins } as AssistEngine, load, unload };
}

describe('PluginsPanel', () => {
  it('says there are no plugins, and offers the example', () => {
    const { engine } = fakeEngine();
    render(<PluginsPanel engine={engine} />);
    expect(screen.getByText('No plugins loaded yet.')).toBeTruthy();
    expect(screen.getByLabelText('Load example plugin')).toBeTruthy();
  });

  it('loads the example plugin when asked', () => {
    const { engine, load } = fakeEngine();
    render(<PluginsPanel engine={engine} />);
    fireEvent.click(screen.getByLabelText('Load example plugin'));
    expect(load).toHaveBeenCalledWith(examplePlugin);
  });

  it('lists a loaded plugin with what it registered', () => {
    const { engine } = fakeEngine({ plugins: [record()], commands: [{ pluginId: 'example.notes', name: 'note', usage: 'Usage: /note <text>', run: () => undefined }] });
    render(<PluginsPanel engine={engine} />);
    expect(screen.getByText('Notes')).toBeTruthy();
    expect(screen.getByText(/registered 1 capability, 1 command, 1 panel/)).toBeTruthy();
    expect(screen.getByText('/note')).toBeTruthy();
  });

  it('shows a failed plugin with its reason, and leaves the example loadable to retry', () => {
    const { engine } = fakeEngine({ plugins: [record({ status: 'failed', error: 'boom' })] });
    render(<PluginsPanel engine={engine} />);
    expect(screen.getByText(/failed — boom/)).toBeTruthy();
    expect((screen.getByLabelText('Load example plugin') as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables the example button once the example is active', () => {
    const { engine } = fakeEngine({ plugins: [record({ status: 'active' })] });
    render(<PluginsPanel engine={engine} />);
    expect((screen.getByLabelText('Load example plugin') as HTMLButtonElement).disabled).toBe(true);
  });

  it('unloads a plugin', () => {
    const { engine, unload } = fakeEngine({ plugins: [record()] });
    render(<PluginsPanel engine={engine} />);
    fireEvent.click(screen.getByLabelText('Unload example.notes'));
    expect(unload).toHaveBeenCalledWith('example.notes');
  });
});
