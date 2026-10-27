import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { activeDisplayId, DisplayPicker } from './display-picker.js';
import { nativeActions } from './bridge.js';
import { displayMediaCapture, nativeCapture } from './capture.js';
import { loadSettings, saveSettings } from './storage.js';
import { DEFAULT_SETTINGS, type AssistEngine } from './use-assist.js';
import type { DisplayInfo, NativeCaptureApi } from './electron/capture-api.js';
import type { AssistSettings, WorkflowStep } from './types.js';

const DISPLAYS: DisplayInfo[] = [
  { id: '1', label: 'Display 1 (primary)', width: 1920, height: 1080, primary: true, thumbnail: 'data:image/png;base64,one' },
  { id: '2', label: 'DELL U2720Q', width: 5120, height: 2880, primary: false, thumbnail: 'data:image/png;base64,two' },
];

function stubApi(displays = DISPLAYS): NativeCaptureApi {
  return {
    startCapture: vi.fn(async () => {}),
    setCaptureInterval: vi.fn(),
    stopCapture: vi.fn(),
    listDisplays: vi.fn(async () => displays),
    selectDisplay: vi.fn(),
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('display selection persistence', () => {
  it('defaults to the primary display (null) on first run', () => {
    expect(DEFAULT_SETTINGS.displayId).toBeNull();
    expect(loadSettings(DEFAULT_SETTINGS).displayId).toBeNull();
  });

  it('round-trips the chosen display id through storage', () => {
    saveSettings({ ...DEFAULT_SETTINGS, displayId: '2' });
    expect(loadSettings(DEFAULT_SETTINGS).displayId).toBe('2');
    saveSettings({ ...DEFAULT_SETTINGS, displayId: null });
    expect(loadSettings(DEFAULT_SETTINGS).displayId).toBeNull();
  });

  it('ignores a corrupt stored display id', () => {
    localStorage.setItem('droid-assist.settings', JSON.stringify({ displayId: 42 }));
    expect(loadSettings(DEFAULT_SETTINGS).displayId).toBeNull();
  });
});

describe('capture routing', () => {
  it('native capture forwards the chosen display to the main process', () => {
    const api = stubApi();
    nativeCapture(api).selectDisplay('2');
    expect(api.selectDisplay).toHaveBeenCalledWith('2');
  });

  it('getDisplayMedia ignores the selection (its prompt picks the screen)', () => {
    const media = { getDisplayMedia: vi.fn() } as unknown as MediaDevices;
    expect(() => displayMediaCapture(media).selectDisplay('2')).not.toThrow();
    expect(media.getDisplayMedia).not.toHaveBeenCalled();
  });

  it('input lands on the secondary display: origin + normalized × its size', () => {
    const step = { id: 's', name: 'Play', action: 'click', x: 0.25, y: 0.5 } as WorkflowStep;
    expect(nativeActions(step, 5120, 2880, { x: 1920, y: -400 })[0]).toMatchObject({ x: 1920 + 1280, y: -400 + 1440 });
    expect(nativeActions(step, 1920, 1080)[0]).toMatchObject({ x: 480, y: 540 });
  });

  it('active display is the chosen one when connected, else the primary', () => {
    expect(activeDisplayId(DISPLAYS, '2')).toBe('2');
    expect(activeDisplayId(DISPLAYS, '999')).toBe('1');
    expect(activeDisplayId(DISPLAYS, null)).toBe('1');
    expect(activeDisplayId([], null)).toBeNull();
  });
});

function Harness({ api, onChange }: { api: NativeCaptureApi; onChange: (s: AssistSettings) => void }) {
  const [settings, set] = useState<AssistSettings>(DEFAULT_SETTINGS);
  const setSettings = (s: AssistSettings) => { set(s); onChange(s); };
  const engine = { settings, setSettings } as unknown as AssistEngine;
  return (
    <>
      <DisplayPicker engine={engine} api={api} />
      <DisplayPicker engine={engine} api={api} compact />
    </>
  );
}

describe('DisplayPicker', () => {
  it('shows each display with label, resolution and thumbnail; Settings and HUD share one selection', async () => {
    const api = stubApi();
    const onChange = vi.fn();
    render(<Harness api={api} onChange={onChange} />);
    const groups = await screen.findAllByRole('radiogroup', { name: 'Capture display' });
    expect(groups).toHaveLength(2);
    expect(screen.getAllByText('5120×2880')).toHaveLength(2);
    expect(screen.getAllByAltText('DELL U2720Q preview')[0].getAttribute('src')).toBe('data:image/png;base64,two');
    expect(screen.getAllByRole('radio', { name: /Display 1 \(primary\)/ })[0].getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getAllByRole('radio', { name: /DELL U2720Q/ })[1]);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ displayId: '2' }));
    for (const radio of screen.getAllByRole('radio', { name: /DELL U2720Q/ })) expect(radio.getAttribute('aria-checked')).toBe('true');
  });

  it('refreshes the thumbnails while open', async () => {
    vi.useFakeTimers();
    const api = stubApi();
    render(<Harness api={api} onChange={() => {}} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    expect(vi.mocked(api.listDisplays).mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('renders nothing outside Electron', () => {
    const engine = { settings: DEFAULT_SETTINGS, setSettings: vi.fn() } as unknown as AssistEngine;
    const { container } = render(<DisplayPicker engine={engine} api={undefined} />);
    expect(container.innerHTML).toBe('');
  });
});
