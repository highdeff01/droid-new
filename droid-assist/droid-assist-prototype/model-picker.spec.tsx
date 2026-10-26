import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODEL_CANDIDATES, ModelPicker, useModelPings } from './model-picker.js';
import { SettingsPanel } from './panels.js';
import { useAssist } from './use-assist.js';
import type { AiConfig, AiStatus } from './ai.js';

const URL_A = 'https://a.example/api/chat';
const URL_B = 'https://b.example/api/chat';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('MODEL_CANDIDATES', () => {
  it('offers the default and other qwen3.5 sizes', () => {
    expect(MODEL_CANDIDATES).toContain('qwen3.5:2b');
    expect(MODEL_CANDIDATES).toContain('qwen3.5:7b');
    expect(new Set(MODEL_CANDIDATES).size).toBe(MODEL_CANDIDATES.length);
  });
});

describe('ModelPicker', () => {
  it('pings one candidate against the current endpoint and shows reachable', async () => {
    const ping = vi.fn(async (cfg: AiConfig): Promise<AiStatus> => ({ state: 'online', detail: `Connected · ${cfg.model}` }));
    render(<ModelPicker url={URL_A} model="qwen3.5:2b" onSelect={() => {}} ping={ping} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ping qwen3.5:7b' }));
    expect(await screen.findByText('reachable — Connected · qwen3.5:7b')).toBeTruthy();
    expect(ping).toHaveBeenCalledWith({ url: URL_A, model: 'qwen3.5:7b' });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('shows the actual error message of a failed ping', async () => {
    const ping = vi.fn(async (): Promise<AiStatus> => ({ state: 'offline', detail: 'AI unavailable — model "qwen3.5:9b" not found' }));
    render(<ModelPicker url={URL_A} model="qwen3.5:2b" onSelect={() => {}} ping={ping} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ping qwen3.5:9b' }));
    expect(await screen.findByText('error — AI unavailable — model "qwen3.5:9b" not found')).toBeTruthy();
  });

  it('shows pinging while in flight and disables that Ping button', async () => {
    let resolve!: (s: AiStatus) => void;
    const ping = vi.fn(() => new Promise<AiStatus>((r) => { resolve = r; }));
    render(<ModelPicker url={URL_A} model="qwen3.5:2b" onSelect={() => {}} ping={ping} />);
    const button = screen.getByRole('button', { name: 'Ping qwen3.5:4b' }) as HTMLButtonElement;
    fireEvent.click(button);
    expect(screen.getByText('pinging… — Pinging qwen3.5:4b…')).toBeTruthy();
    expect(button.disabled).toBe(true);
    await act(async () => resolve({ state: 'online', detail: 'ok' }));
    expect(button.disabled).toBe(false);
  });

  it('selecting a chip or typing a name calls onSelect without pinging', () => {
    const onSelect = vi.fn();
    const ping = vi.fn();
    render(<ModelPicker url={URL_A} model="qwen3.5:2b" onSelect={onSelect} ping={ping} />);
    fireEvent.click(screen.getByRole('button', { name: 'qwen3.5:7b' }));
    fireEvent.change(screen.getByLabelText('AI model'), { target: { value: 'llama3:8b' } });
    expect(onSelect.mock.calls).toEqual([['qwen3.5:7b'], ['llama3:8b']]);
    expect(ping).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'qwen3.5:2b' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('useModelPings', () => {
  it('discards a ping that resolves after the endpoint changed, and clears old results', async () => {
    const resolvers: ((s: AiStatus) => void)[] = [];
    const ping = vi.fn(() => new Promise<AiStatus>((r) => { resolvers.push(r); }));
    const { result, rerender } = renderHook(({ url }) => useModelPings(url, ping), { initialProps: { url: URL_A } });
    let pending!: Promise<void>;
    act(() => { pending = result.current.pingModel('qwen3.5:2b'); });
    rerender({ url: URL_B });
    expect(result.current.pings).toEqual({});
    await act(async () => { resolvers[0]({ state: 'online', detail: 'stale' }); await pending; });
    expect(result.current.pings).toEqual({});
  });
});

describe('SettingsPanel model picker wiring', () => {
  function Harness() {
    return <SettingsPanel engine={useAssist()} />;
  }

  it('selecting a chip persists aiModel and re-checks the live status against that model', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ message: { role: 'assistant', content: 'OK' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    render(<Harness />);
    await waitFor(() => expect(screen.getAllByText(/Connected · qwen3\.5:2b/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'qwen3.5:7b' }));
    expect(JSON.parse(localStorage.getItem('droid-assist.settings') ?? '{}').aiModel).toBe('qwen3.5:7b');
    expect((screen.getByLabelText('AI model') as HTMLInputElement).value).toBe('qwen3.5:7b');
    await waitFor(() => expect(screen.getAllByText(/Connected · qwen3\.5:7b/).length).toBeGreaterThan(0));
    const models = fetchSpy.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)).model);
    expect(models).toContain('qwen3.5:7b');
  });

  it('a candidate ping through the real health check shows the real failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Ping qwen3.5:4b' }));
    const item = (await screen.findByRole('button', { name: 'Ping qwen3.5:4b' })).closest('li') as HTMLElement;
    await waitFor(() => expect(item.textContent).toMatch(/error — AI unavailable — .*Failed to fetch/));
    expect(item.getAttribute('data-tone')).toBe('error');
  });
});
