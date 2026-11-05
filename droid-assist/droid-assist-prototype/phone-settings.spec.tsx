import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhoneSettings } from './phone-settings.js';
import { DEFAULT_SETTINGS } from './use-assist.js';
import type { AssistEngine } from './use-assist.js';

afterEach(cleanup);

/** A fake engine carrying only what PhoneSettings reads. */
function fakeEngine(over: { supported?: boolean; running?: boolean; url?: string; message?: string } = {}) {
  const setSettings = vi.fn();
  const start = vi.fn(async () => undefined);
  const stop = vi.fn();
  const engine = {
    settings: { ...DEFAULT_SETTINGS },
    setSettings,
    phone: {
      view: { supported: over.supported ?? true, running: over.running ?? false, url: over.url ?? '', message: over.message ?? 'Not running' },
      start,
      stop,
    },
  } as unknown as AssistEngine;
  return { engine, setSettings, start, stop };
}

describe('PhoneSettings', () => {
  it('edits the port and token', () => {
    const { engine, setSettings } = fakeEngine();
    render(<PhoneSettings engine={engine} />);
    fireEvent.change(screen.getByLabelText('Phone companion port'), { target: { value: '9000' } });
    expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ phonePort: 9000 }));
    fireEvent.change(screen.getByLabelText('Phone companion token'), { target: { value: 'abc' } });
    expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ phoneToken: 'abc' }));
  });

  it('starts the companion with the configured port and token', () => {
    const { engine, start } = fakeEngine();
    render(<PhoneSettings engine={engine} />);
    fireEvent.click(screen.getByLabelText('Start phone companion'));
    expect(start).toHaveBeenCalledWith({ host: '0.0.0.0', port: DEFAULT_SETTINGS.phonePort, token: DEFAULT_SETTINGS.phoneToken });
  });

  it('shows the URL and stops while running', () => {
    const { engine, stop } = fakeEngine({ running: true, url: 'http://10.0.0.5:8788/', message: 'Listening' });
    render(<PhoneSettings engine={engine} />);
    expect(screen.getByText('http://10.0.0.5:8788/')).toBeTruthy();
    expect((screen.getByLabelText('Start phone companion') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Stop phone companion'));
    expect(stop).toHaveBeenCalled();
  });

  it('disables starting honestly when unsupported', () => {
    const { engine } = fakeEngine({ supported: false, message: 'The phone companion is only available in the packaged app' });
    render(<PhoneSettings engine={engine} />);
    expect((screen.getByLabelText('Start phone companion') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(/only available in the packaged app/).length).toBeGreaterThan(0);
  });
});
