import { useEffect, useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import type { DisplayInfo, NativeCaptureApi } from './electron/capture-api.js';
import styles from './droid-assist.module.css';

/** How often the picker re-lists displays so each thumbnail stays live. */
export const DISPLAY_POLL_MS = 2000;

/** The connected displays, re-listed every `pollMs` while mounted; empty outside Electron. */
export function useDisplays(api: NativeCaptureApi | undefined = window.droidNative, pollMs = DISPLAY_POLL_MS): DisplayInfo[] {
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  useEffect(() => {
    if (!api) return undefined;
    let alive = true;
    const refresh = () => api.listDisplays().then((list) => { if (alive) setDisplays(list); }, () => {});
    void refresh();
    const id = setInterval(refresh, pollMs);
    return () => { alive = false; clearInterval(id); };
  }, [api, pollMs]);
  return displays;
}

/** The display capture uses: the chosen one when it is still connected, else the primary. */
export function activeDisplayId(displays: readonly DisplayInfo[], selected: string | null): string | null {
  const chosen = displays.find((d) => d.id === selected);
  return (chosen ?? displays.find((d) => d.primary))?.id ?? null;
}

/**
 * Display picker: one button per connected display with its label, resolution and live
 * thumbnail; choosing one persists `settings.displayId` and routes native capture to it.
 * Renders nothing outside Electron, where the getDisplayMedia prompt picks the screen.
 */
export function DisplayPicker({ engine, compact = false, api = window.droidNative }: { engine: AssistEngine; compact?: boolean; api?: NativeCaptureApi }) {
  const displays = useDisplays(api);
  const { settings, setSettings } = engine;
  if (!api || !displays.length) return null;
  const active = activeDisplayId(displays, settings.displayId);
  return (
    <div className={compact ? styles.displayPickerCompact : styles.displayPicker} role="radiogroup" aria-label="Capture display">
      {displays.map((d) => (
        <button
          key={d.id}
          type="button"
          role="radio"
          aria-checked={d.id === active}
          data-active={d.id === active}
          className={styles.displayOption}
          onClick={() => setSettings({ ...settings, displayId: d.id })}
          title={`Capture ${d.label} (${d.width}×${d.height})`}
        >
          {d.thumbnail && <img src={d.thumbnail} alt={`${d.label} preview`} />}
          <span>{d.label}</span>
          <small>{d.width}×{d.height}</small>
        </button>
      ))}
    </div>
  );
}
