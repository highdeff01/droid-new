import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BridgeWizard } from './bridge-wizard.js';
import { NOTHING_FOUND } from './bridge-discovery.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A fake network where only `alive` hosts answer health, and replays complete. */
function network(alive: Record<string, number>) {
  return vi.fn(async (url: string) => {
    const origin = new URL(url).origin;
    if (!(origin in alive)) throw new TypeError('Failed to fetch');
    if (url.endsWith('/api/health')) return json(alive[origin], { success: alive[origin] === 200 });
    if (url.endsWith('/api/replay')) return json(202, { success: true, run: { id: 'r1', status: 'running' } });
    return json(200, { success: true, run: { id: 'r1', status: 'completed' } });
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const setup = (props: Partial<Parameters<typeof BridgeWizard>[0]> = {}) => {
  const onFill = vi.fn();
  const onConnect = vi.fn().mockResolvedValue(true);
  render(<BridgeWizard bridgeUrl="" token="tok" onFill={onFill} onConnect={onConnect} {...props} />);
  return { onFill, onConnect };
};

describe('BridgeWizard', () => {
  it('says honestly that nothing was found, with a hint to start the python-service', async () => {
    vi.stubGlobal('fetch', network({}));
    setup();
    fireEvent.click(screen.getByText('Find bridge'));
    await waitFor(() => expect(screen.getByText(NOTHING_FOUND)).toBeTruthy());
    expect(NOTHING_FOUND).toMatch(/python-service/);
  });

  it('lists a found bridge, auto-fills its URL on pick, verifies end to end and connects', async () => {
    vi.stubGlobal('fetch', network({ 'http://127.0.0.1:3000': 200 }));
    const { onFill, onConnect } = setup();
    fireEvent.click(screen.getByText('Find bridge'));
    const use = await screen.findByLabelText('Use http://127.0.0.1:3000');
    expect(screen.getByLabelText('Bridge candidates').textContent).toMatch(/\d+ ms — online/);
    fireEvent.click(use);
    expect(onFill).toHaveBeenCalledWith('http://127.0.0.1:3000', 'tok');
    fireEvent.click(screen.getByText('Verify & connect'));
    await screen.findByText('Bridge connected: http://127.0.0.1:3000');
    expect(screen.getByLabelText('Bridge verification').textContent).toMatch(/Health check.*Dry run \(wait\)/);
    expect(onConnect).toHaveBeenCalledWith('http://127.0.0.1:3000', 'tok');
  });

  it('shows a token-required candidate, tests the entered token and does not connect on refusal', async () => {
    vi.stubGlobal('fetch', network({ 'http://localhost:3000': 401 }));
    const { onConnect } = setup({ token: '' });
    fireEvent.click(screen.getByText('Find bridge'));
    fireEvent.click(await screen.findByLabelText('Use http://localhost:3000'));
    fireEvent.change(screen.getByLabelText('Wizard bridge token'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByText('Test token'));
    await screen.findByText(/unauthorized — check bridge token/);
    fireEvent.click(screen.getByText('Verify & connect'));
    await screen.findByText('Not connected — http://localhost:3000 failed verification');
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('keeps the insecure-HTTP warning on a discovered plain-http LAN candidate', async () => {
    vi.stubGlobal('fetch', network({ 'http://10.9.8.7:3000': 200 }));
    setup({ bridgeUrl: 'http://10.9.8.1:3000' });
    fireEvent.click(screen.getByText('Find bridge'));
    const use = await screen.findByLabelText('Use http://10.9.8.7:3000', {}, { timeout: 4000 });
    expect(screen.getByLabelText('Bridge candidates').textContent).toMatch(/plain http on the LAN/);
    fireEvent.click(use);
    expect(screen.getByRole('alert').textContent).toMatch(/INSECURE BRIDGE: http:\/\/10\.9\.8\.7:3000/);
  });
});
