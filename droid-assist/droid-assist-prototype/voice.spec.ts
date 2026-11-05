import { describe, expect, it, vi } from 'vitest';
import { createVoiceControl, finalTranscript, type SpeechRecognizer, type VoiceConfig, type VoiceEngines } from './voice.js';

/** A recognizer that records calls and lets a test fire events. */
class FakeRecognizer implements SpeechRecognizer {
  lang = '';
  continuous = false;
  interimResults = false;
  started = 0;
  aborted = 0;
  onresult: SpeechRecognizer['onresult'] = null;
  onerror: SpeechRecognizer['onerror'] = null;
  onend: SpeechRecognizer['onend'] = null;
  start() { this.started++; }
  stop() { /* not used by the control */ }
  abort() { this.aborted++; }
  /** Fires a final result for `text`. */
  say(text: string) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
  }
}

function fakeEngines(over: Partial<VoiceEngines> = {}) {
  const rec = new FakeRecognizer();
  const spoken: string[] = [];
  let cancels = 0;
  const engines: VoiceEngines = {
    sttAvailable: () => true,
    ttsAvailable: () => true,
    createRecognizer: () => rec,
    speak: (text) => spoken.push(text),
    cancelSpeech: () => { cancels++; },
    ...over,
  };
  return { engines, rec, spoken, cancels: () => cancels };
}

const config = (over: Partial<VoiceConfig> = {}): VoiceConfig => ({
  enabled: true, mode: 'push-to-talk', lang: 'en-US', speakNotifications: false, speakResponses: false, rate: 1, volume: 1, ...over,
});

describe('finalTranscript', () => {
  it('joins only the final results from resultIndex on', () => {
    const event = { resultIndex: 1, results: [{ isFinal: true, 0: { transcript: 'ignored ' } }, { isFinal: true, 0: { transcript: 'hello ' } }, { isFinal: false, 0: { transcript: 'wor' } }] };
    expect(finalTranscript(event)).toBe('hello');
  });

  it('returns nothing when no result is final', () => {
    expect(finalTranscript({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: 'hi' } }] })).toBe('');
  });
});

describe('createVoiceControl', () => {
  it('does nothing while disabled', () => {
    const { engines, rec } = fakeEngines();
    const submit = vi.fn();
    const voice = createVoiceControl(engines, { submit, log: () => undefined });
    voice.configure(config({ enabled: false }));
    voice.press();
    expect(rec.started).toBe(0);
    expect(voice.listening()).toBe(false);
  });

  it('routes a final transcript into submit and logs what it heard', () => {
    const { engines, rec } = fakeEngines();
    const submit = vi.fn();
    const logged: string[] = [];
    const voice = createVoiceControl(engines, { submit, log: (m) => logged.push(m) });
    voice.configure(config());
    voice.press();
    expect(rec.started).toBe(1);
    rec.say('click the files icon');
    expect(submit).toHaveBeenCalledWith('click the files icon');
    expect(logged.some((l) => l.includes('Heard: click the files icon'))).toBe(true);
  });

  it('closes the microphone on release in push-to-talk mode', () => {
    const { engines, rec } = fakeEngines();
    const voice = createVoiceControl(engines, { submit: () => undefined, log: () => undefined });
    voice.configure(config());
    voice.press();
    voice.release();
    expect(rec.aborted).toBe(1);
    expect(voice.listening()).toBe(false);
  });

  it('keeps listening across results in always-on mode', () => {
    const { engines, rec } = fakeEngines();
    const submit = vi.fn();
    const voice = createVoiceControl(engines, { submit, log: () => undefined });
    voice.configure(config({ mode: 'always-on' }));
    expect(voice.listening()).toBe(true);
    rec.say('one');
    rec.say('two');
    expect(submit).toHaveBeenCalledTimes(2);
    expect(voice.listening()).toBe(true);
  });

  it('reports honestly when speech-to-text is unavailable', () => {
    const { engines } = fakeEngines({ sttAvailable: () => false });
    const logged: string[] = [];
    const voice = createVoiceControl(engines, { submit: () => undefined, log: (m) => logged.push(m) });
    voice.configure(config({ mode: 'always-on' }));
    expect(voice.sttAvailable()).toBe(false);
    expect(voice.listening()).toBe(false);
    expect(logged).toEqual([]);
  });

  it('logs a recognition error rather than throwing', () => {
    const { engines, rec } = fakeEngines();
    const logged: string[] = [];
    const voice = createVoiceControl(engines, { submit: () => undefined, log: (m) => logged.push(m) });
    voice.configure(config());
    voice.press();
    rec.onerror?.({ error: 'not-allowed' });
    expect(logged.some((l) => l.includes('not-allowed'))).toBe(true);
  });

  it('speaks notifications and answers only when their toggles are on', () => {
    const { engines, spoken } = fakeEngines();
    const voice = createVoiceControl(engines, { submit: () => undefined, log: () => undefined });
    voice.configure(config({ speakNotifications: true, speakResponses: false }));
    voice.announce('Bridge: connected');
    voice.sayAnswer('the Files icon is at the top left');
    expect(spoken).toEqual(['Bridge: connected']);
    voice.configure(config({ speakNotifications: true, speakResponses: true }));
    voice.sayAnswer('  the Files icon is at the top left  ');
    expect(spoken).toEqual(['Bridge: connected', 'the Files icon is at the top left']);
  });

  it('does not speak when voice control is off or nothing is available', () => {
    const { engines, spoken } = fakeEngines({ ttsAvailable: () => false });
    const voice = createVoiceControl(engines, { submit: () => undefined, log: () => undefined });
    voice.configure(config({ speakNotifications: true }));
    voice.announce('x');
    expect(spoken).toEqual([]);
    voice.configure(config({ enabled: false, speakNotifications: true }));
    voice.announce('x');
    expect(spoken).toEqual([]);
  });

  it('stop cancels speech and closes the microphone', () => {
    const { engines, rec, cancels } = fakeEngines();
    const voice = createVoiceControl(engines, { submit: () => undefined, log: () => undefined });
    voice.configure(config({ mode: 'always-on' }));
    voice.stop();
    expect(cancels()).toBe(1);
    expect(rec.aborted).toBe(1);
    expect(voice.listening()).toBe(false);
  });
});
