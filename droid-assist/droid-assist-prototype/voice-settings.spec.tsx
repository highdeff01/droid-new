import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceSettings } from './voice-settings.js';
import { DEFAULT_SETTINGS } from './use-assist.js';
import type { AssistEngine } from './use-assist.js';

afterEach(cleanup);

/** A fake engine carrying only what VoiceSettings reads. */
function fakeEngine(over: { stt?: boolean; tts?: boolean; enabled?: boolean } = {}) {
  const setSettings = vi.fn();
  const start = vi.fn();
  const stop = vi.fn();
  const engine = {
    settings: { ...DEFAULT_SETTINGS, voiceEnabled: over.enabled ?? false },
    setSettings,
    voice: { sttAvailable: () => over.stt ?? true, ttsAvailable: () => over.tts ?? true, listening: () => false, start, stop },
  } as unknown as AssistEngine;
  return { engine, setSettings, start, stop };
}

describe('VoiceSettings', () => {
  it('toggles voice control in the settings', () => {
    const { engine, setSettings } = fakeEngine();
    render(<VoiceSettings engine={engine} />);
    fireEvent.click(screen.getByLabelText('Voice control'));
    expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ voiceEnabled: true }));
  });

  it('changes the listening mode and language', () => {
    const { engine, setSettings } = fakeEngine();
    render(<VoiceSettings engine={engine} />);
    fireEvent.change(screen.getByLabelText('Listening mode'), { target: { value: 'always-on' } });
    expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ voiceMode: 'always-on' }));
    fireEvent.change(screen.getByLabelText('Speech language'), { target: { value: 'en-GB' } });
    expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ voiceLang: 'en-GB' }));
  });

  it('changes the speech rate and volume', () => {
    const { engine, setSettings } = fakeEngine();
    render(<VoiceSettings engine={engine} />);
    fireEvent.change(screen.getByLabelText('Speech rate'), { target: { value: '1.5' } });
    expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ voiceRate: 1.5 }));
    fireEvent.change(screen.getByLabelText('Speech volume'), { target: { value: '0.5' } });
    expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ voiceVolume: 0.5 }));
  });

  it('starts and stops listening', () => {
    const { engine, start, stop } = fakeEngine({ enabled: true });
    render(<VoiceSettings engine={engine} />);
    fireEvent.click(screen.getByLabelText('Listen now'));
    expect(start).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Stop listening'));
    expect(stop).toHaveBeenCalled();
  });

  it('disables the listening and speech controls honestly when unsupported', () => {
    const { engine } = fakeEngine({ stt: false, tts: false });
    render(<VoiceSettings engine={engine} />);
    expect((screen.getByLabelText('Listen now') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Speak notifications') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/no speech synthesis/)).toBeTruthy();
  });
});
