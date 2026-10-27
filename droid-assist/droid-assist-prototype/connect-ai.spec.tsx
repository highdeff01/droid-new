import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from './panels.js';
import { AiStatusBadge, Hud } from './hud.js';
import { useAssist } from './use-assist.js';

const okReply = () => new Response(JSON.stringify({ message: { role: 'assistant', content: 'OK' } }), { status: 200 });
const bodyOf = (call: unknown) => JSON.parse(String((call as [string, RequestInit])[1].body));
const stored = () => JSON.parse(localStorage.getItem('droid-assist.settings') ?? '{}');

function Harness() {
  const engine = useAssist();
  return (
    <>
      <div data-testid="settings"><SettingsPanel engine={engine} /></div>
      <div data-testid="hud"><Hud engine={engine} /></div>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Settings Connect button', () => {
  it('pings the configured endpoint+model with the health check, saves the settings and shows Connected · model', async () => {
    const fetchSpy = vi.fn(async () => okReply());
    vi.stubGlobal('fetch', fetchSpy);
    render(<Harness />);
    const settings = within(screen.getByTestId('settings'));
    fireEvent.change(settings.getByLabelText('AI endpoint URL'), { target: { value: 'http://x.test/api/chat' } });
    fireEvent.change(settings.getByLabelText('AI model'), { target: { value: 'm1' } });
    await waitFor(() => expect(settings.getByText(/Connected · m1 @ x\.test/)).toBeTruthy());
    localStorage.removeItem('droid-assist.settings');
    const before = fetchSpy.mock.calls.length;

    fireEvent.click(settings.getByRole('button', { name: 'Connect AI' }));

    expect(stored()).toMatchObject({ aiUrl: 'http://x.test/api/chat', aiModel: 'm1' });
    await waitFor(() => expect(fetchSpy.mock.calls.length).toBe(before + 1));
    const call = fetchSpy.mock.calls[before] as unknown as [string, RequestInit];
    expect(call[0]).toBe('http://x.test/api/chat');
    expect(bodyOf(call).model).toBe('m1');
    expect(bodyOf(call).messages.at(-1).content).toBe('Reply with OK.');
    await waitFor(() => expect(settings.getByText(/Connected · m1 @ x\.test/)).toBeTruthy());
    expect(within(screen.getByTestId('hud')).getByText(/Connected · m1 @ x\.test/)).toBeTruthy();
  });

  it('shows the failure detail when the endpoint is down, and still saves what was pinged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('ECONNREFUSED'); }));
    render(<Harness />);
    const settings = within(screen.getByTestId('settings'));
    fireEvent.change(settings.getByLabelText('AI endpoint URL'), { target: { value: 'http://bad.test/api/chat' } });
    await waitFor(() => expect(settings.getByText(/AI unavailable — .*ECONNREFUSED/)).toBeTruthy());
    localStorage.removeItem('droid-assist.settings');

    fireEvent.click(settings.getByRole('button', { name: 'Connect AI' }));

    expect(stored().aiUrl).toBe('http://bad.test/api/chat');
    expect(settings.getByText(/Connecting to http:\/\/bad\.test\/api\/chat/)).toBeTruthy();
    await waitFor(() => expect(settings.getByText(/AI unavailable — .*ECONNREFUSED/)).toBeTruthy());
    expect(within(screen.getByTestId('hud')).getByText(/AI unavailable — .*ECONNREFUSED/)).toBeTruthy();
  });
});

describe('HUD AI status summary', () => {
  it('shows the active endpoint and model in every state', () => {
    const config = { url: 'https://quantumclaw.net/ollama/api/chat', model: 'qwen3.5:2b' };
    render(<AiStatusBadge status={{ state: 'offline', detail: 'AI unavailable — down' }} config={config} />);
    expect(screen.getByTestId('ai-summary').textContent).toBe('qwen3.5:2b @ https://quantumclaw.net/ollama/api/chat');
  });

  it('follows a model change in the HUD', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okReply()));
    render(<Harness />);
    const hud = within(screen.getByTestId('hud'));
    expect(hud.getByTestId('ai-summary').textContent).toBe('qwen3.5:2b @ https://quantumclaw.net/ollama/api/chat');
    fireEvent.change(within(screen.getByTestId('settings')).getByLabelText('AI model'), { target: { value: 'qwen3.5:7b' } });
    expect(hud.getByTestId('ai-summary').textContent).toBe('qwen3.5:7b @ https://quantumclaw.net/ollama/api/chat');
  });
});
