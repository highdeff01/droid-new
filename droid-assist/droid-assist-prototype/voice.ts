/**
 * Voice control: speech-to-text for commands and text-to-speech for notifications and AI answers.
 * The recognition and speech engines are injected, so the routing (what a transcript does, what gets
 * spoken) is testable without a microphone or a speaker.
 */

/** Why voice control cannot run here. */
export const VOICE_UNSUPPORTED = 'Voice control needs a browser with the Web Speech API (Chrome or Edge)';

/** The minimal shape of the browser SpeechRecognition API this uses. */
export interface SpeechRecognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

/** How the microphone is opened: hold to talk, or leave it open. */
export type VoiceMode = 'push-to-talk' | 'always-on';

/** The voice modes, for the settings picker and the stored-value check. */
export const VOICE_MODES: readonly VoiceMode[] = ['push-to-talk', 'always-on'];

/** Speech rate bounds, for the settings slider and the stored-value check. */
export const VOICE_RATE_RANGE: readonly [number, number] = [0.5, 2];
/** Speech volume bounds, for the settings slider and the stored-value check. */
export const VOICE_VOLUME_RANGE: readonly [number, number] = [0, 1];

/** What a transcript is routed to. */
export interface VoiceRouter {
  /** Runs a command or goal, exactly as if it were typed. */
  submit(text: string): void;
  log(message: string, tone?: 'info' | 'warn' | 'error'): void;
}

/** The speech engines, injected so tests need neither a microphone nor a speaker. */
export interface VoiceEngines {
  /** Whether speech-to-text is available at all. */
  sttAvailable(): boolean;
  /** Whether text-to-speech is available at all. */
  ttsAvailable(): boolean;
  /** Creates a recognizer for `lang`, or null when unavailable. */
  createRecognizer(lang: string): SpeechRecognizer | null;
  /** Speaks `text`, cancelling anything already speaking. */
  speak(text: string, opts: { lang: string; rate: number; volume: number }): void;
  /** Stops any speech in progress. */
  cancelSpeech(): void;
}

/** The browser engines: the Web Speech API when present, otherwise honest stubs. */
export function browserEngines(): VoiceEngines {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognizer; webkitSpeechRecognition?: new () => SpeechRecognizer; speechSynthesis?: SpeechSynthesis };
  const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  const synth = w.speechSynthesis;
  return {
    sttAvailable: () => !!Recognition,
    ttsAvailable: () => !!synth && typeof window.SpeechSynthesisUtterance === 'function',
    createRecognizer: (lang) => {
      if (!Recognition) return null;
      const rec = new Recognition();
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = false;
      return rec;
    },
    speak: (text, opts) => {
      if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') return;
      synth.cancel();
      const u = new window.SpeechSynthesisUtterance(text);
      u.lang = opts.lang;
      u.rate = opts.rate;
      u.volume = opts.volume;
      synth.speak(u);
    },
    cancelSpeech: () => synth?.cancel(),
  };
}

/** Voice settings, from AssistSettings. */
export interface VoiceConfig {
  enabled: boolean;
  mode: VoiceMode;
  /** Speech-to-text language, e.g. `en-US`. */
  lang: string;
  /** Speak notifications aloud. */
  speakNotifications: boolean;
  /** Speak AI answers aloud. */
  speakResponses: boolean;
  /** Speech rate (0.5–2). */
  rate: number;
  /** Speech volume (0–1). */
  volume: number;
}

/** The joined final transcripts from one recognition event, in order. */
export function finalTranscript(event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }): string {
  let out = '';
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = event.results[i];
    if (result?.isFinal) out += result[0].transcript;
  }
  return out.trim();
}

/**
 * Voice control: listens (always-on, or while push-to-talk is held) and routes each final transcript
 * through `submit`, and speaks notifications and AI answers when the matching toggle is on. Every
 * transition is reported through the router's log so the panel can show the real state.
 */
export function createVoiceControl(engines: VoiceEngines, router: VoiceRouter) {
  let config: VoiceConfig = { enabled: false, mode: 'push-to-talk', lang: 'en-US', speakNotifications: false, speakResponses: false, rate: 1, volume: 1 };
  let recognizer: SpeechRecognizer | null = null;
  let listening = false;
  let pttHeld = false;

  /** Whether the mic should be open right now. */
  const shouldListen = () => config.enabled && engines.sttAvailable() && (config.mode === 'always-on' || pttHeld);

  const openMic = () => {
    if (listening || !shouldListen()) return;
    recognizer = engines.createRecognizer(config.lang);
    if (!recognizer) return;
    recognizer.onresult = (event) => {
      const text = finalTranscript(event);
      if (!text) return;
      router.log(`Heard: ${text}`, 'info');
      router.submit(text);
      if (config.mode === 'push-to-talk' && !pttHeld) closeMic();
    };
    recognizer.onerror = (event) => router.log(`Voice input error: ${event.error ?? 'unknown'}`, 'warn');
    recognizer.onend = () => { listening = false; };
    try {
      recognizer.start();
      listening = true;
      router.log(config.mode === 'always-on' ? 'Listening (always on)' : 'Listening', 'info');
    } catch (error) {
      router.log(`Could not start listening — ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const closeMic = () => {
    if (!recognizer) return;
    try { recognizer.abort(); } catch { /* already stopped */ }
    recognizer = null;
    listening = false;
  };

  return {
    /** The live configuration. */
    config: () => config,
    /** Whether the mic is open. */
    listening: () => listening,
    /** Whether speech-to-text can run here. */
    sttAvailable: () => engines.sttAvailable(),
    /** Whether text-to-speech can run here. */
    ttsAvailable: () => engines.ttsAvailable(),

    /** Applies new settings: opens or closes the mic to match. */
    configure(next: VoiceConfig) {
      const modeChanged = next.mode !== config.mode || next.lang !== config.lang;
      config = next;
      if (!config.enabled) { closeMic(); return; }
      if (modeChanged) { closeMic(); }
      if (shouldListen()) openMic();
      else closeMic();
    },

    /** Push-to-talk: the key went down. */
    press() {
      pttHeld = true;
      if (config.mode === 'push-to-talk') openMic();
    },

    /** Push-to-talk: the key came up. */
    release() {
      pttHeld = false;
      if (config.mode === 'push-to-talk') closeMic();
    },

    /** Starts listening now (always-on toggle, or the panel's Listen button). */
    start() {
      pttHeld = true;
      openMic();
    },

    /** Stops listening and cancels any speech. */
    stop() {
      pttHeld = false;
      closeMic();
      engines.cancelSpeech();
    },

    /** Speaks a notification aloud, when that toggle is on. */
    announce(title: string) {
      if (!config.enabled || !config.speakNotifications || !engines.ttsAvailable()) return;
      engines.speak(title, { lang: config.lang, rate: config.rate, volume: config.volume });
    },

    /** Speaks an AI answer aloud, when that toggle is on. */
    sayAnswer(text: string) {
      if (!config.enabled || !config.speakResponses || !engines.ttsAvailable()) return;
      const clean = text.trim();
      if (!clean) return;
      engines.speak(clean, { lang: config.lang, rate: config.rate, volume: config.volume });
    },
  };
}

/** The voice control the engine exposes. */
export type VoiceControl = ReturnType<typeof createVoiceControl>;
