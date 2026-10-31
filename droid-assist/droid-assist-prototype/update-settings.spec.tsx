import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateSettings } from './update-settings.js';
import type { AssistEngine } from './use-assist.js';
import type { UpdateView } from './use-update.js';

afterEach(cleanup);

/** A minimal fake engine carrying only what UpdateSettings reads. */
function fakeEngine(view: UpdateView, autoUpdate = true) {
  const setSettings = vi.fn();
  const checkNow = vi.fn(async () => null);
  const updateNow = vi.fn(async () => null);
  const engine = { settings: { autoUpdate }, setSettings, update: { view, checkNow, updateNow } } as unknown as AssistEngine;
  return { engine, setSettings, checkNow, updateNow };
}

const view = (over: Partial<UpdateView> = {}): UpdateView => ({ phase: 'idle', behind: 0, latest: '', version: '0.1.0', message: 'Up to date', ...over });

describe('UpdateSettings', () => {
  it('shows the status line and the auto-update toggle', () => {
    const { engine } = fakeEngine(view({ phase: 'available', behind: 2, latest: 'Add voice', message: '2 new commits' }));
    const { getByLabelText } = render(<UpdateSettings engine={engine} />);
    expect(getByLabelText('Update status').textContent).toContain('Update available');
    expect(getByLabelText('Auto-update on start')).toBeTruthy();
  });

  it('toggles auto-update in settings', () => {
    const { engine, setSettings } = fakeEngine(view());
    const { getByLabelText } = render(<UpdateSettings engine={engine} />);
    fireEvent.click(getByLabelText('Auto-update on start'));
    expect(setSettings).toHaveBeenCalledWith({ autoUpdate: false });
  });

  it('checks and updates by hand', () => {
    const { engine, checkNow, updateNow } = fakeEngine(view({ phase: 'available', behind: 1, message: '1 new commit' }));
    const { getByLabelText } = render(<UpdateSettings engine={engine} />);
    fireEvent.click(getByLabelText('Check for updates'));
    expect(checkNow).toHaveBeenCalled();
    fireEvent.click(getByLabelText('Update now'));
    expect(updateNow).toHaveBeenCalled();
  });

  it('disables Update now when there is nothing to update', () => {
    const { engine } = fakeEngine(view());
    const { getByLabelText } = render(<UpdateSettings engine={engine} />);
    expect((getByLabelText('Update now') as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables both buttons in a plain browser', () => {
    const { engine } = fakeEngine(view({ phase: 'unsupported', message: 'Updates are only available in the packaged app' }));
    const { getByLabelText } = render(<UpdateSettings engine={engine} />);
    expect((getByLabelText('Check for updates') as HTMLButtonElement).disabled).toBe(true);
    expect(getByLabelText('Update status').textContent).toContain('packaged app');
  });
});
