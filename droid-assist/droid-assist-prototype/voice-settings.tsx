import type { AssistEngine } from './use-assist.js';
import { VOICE_MODES, VOICE_RATE_RANGE, VOICE_VOLUME_RANGE, type VoiceMode } from './voice.js';
import styles from './droid-assist.module.css';

/** The label for each voice mode. */
const MODE_LABEL: Record<VoiceMode, string> = { 'push-to-talk': 'Push to talk (hold Ctrl+Space)', 'always-on': 'Always listening' };

/** Settings → Voice: speech-to-text for commands, text-to-speech for notifications and answers. */
export function VoiceSettings({ engine }: { engine: AssistEngine }) {
  const { settings, setSettings, voice } = engine;
  const stt = voice.sttAvailable();
  const tts = voice.ttsAvailable();
  const set = (patch: Partial<typeof settings>) => setSettings({ ...settings, ...patch });
  return (
    <>
      <h3>Voice <small>{stt ? (voice.listening() ? 'listening' : 'ready') : 'speech-to-text unavailable'}</small></h3>
      <label className={styles.agent}>
        <input type="checkbox" checked={settings.voiceEnabled} onChange={(e) => set({ voiceEnabled: e.target.checked })} aria-label="Voice control" />
        <span>
          <strong>Voice control</strong>
          <small>{stt ? 'Spoken commands ("click the files icon", "run the shopping workflow") go through the same command parser as typed input.' : 'This browser has no Web Speech API — use Chrome or Edge for voice input.'}</small>
        </span>
      </label>
      <label className={styles.setting}>
        <span>Listening mode</span>
        <select value={settings.voiceMode} onChange={(e) => set({ voiceMode: e.target.value as VoiceMode })} aria-label="Listening mode">
          {VOICE_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
        </select>
      </label>
      <label className={styles.setting}>
        <span>Speech language</span>
        <input type="text" value={settings.voiceLang} onChange={(e) => set({ voiceLang: e.target.value })} aria-label="Speech language" placeholder="en-US" />
      </label>
      <label className={styles.agent}>
        <input type="checkbox" checked={settings.voiceSpeakNotifications} onChange={(e) => set({ voiceSpeakNotifications: e.target.checked })} aria-label="Speak notifications" disabled={!tts} />
        <span><strong>Speak notifications</strong><small>Read new notifications aloud.</small></span>
      </label>
      <label className={styles.agent}>
        <input type="checkbox" checked={settings.voiceSpeakResponses} onChange={(e) => set({ voiceSpeakResponses: e.target.checked })} aria-label="Speak AI answers" disabled={!tts} />
        <span><strong>Speak AI answers</strong><small>Read the AI's screen answers aloud.</small></span>
      </label>
      <label className={styles.setting}>
        <span>Speech rate <small>{settings.voiceRate.toFixed(1)}×</small></span>
        <input type="range" min={VOICE_RATE_RANGE[0]} max={VOICE_RATE_RANGE[1]} step={0.1} value={settings.voiceRate} onChange={(e) => set({ voiceRate: Number(e.target.value) })} aria-label="Speech rate" disabled={!tts} />
      </label>
      <label className={styles.setting}>
        <span>Speech volume <small>{Math.round(settings.voiceVolume * 100)}%</small></span>
        <input type="range" min={VOICE_VOLUME_RANGE[0]} max={VOICE_VOLUME_RANGE[1]} step={0.05} value={settings.voiceVolume} onChange={(e) => set({ voiceVolume: Number(e.target.value) })} aria-label="Speech volume" disabled={!tts} />
      </label>
      <span className={styles.row}>
        <button type="button" onClick={() => voice.start()} disabled={!settings.voiceEnabled || !stt} aria-label="Listen now">Listen now</button>
        <button type="button" onClick={() => voice.stop()} disabled={!settings.voiceEnabled} aria-label="Stop listening">Stop</button>
      </span>
      {!tts && <p className={styles.muted}>This browser has no speech synthesis — spoken replies are unavailable.</p>}
    </>
  );
}
