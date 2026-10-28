import { useEffect, useRef } from 'react';

/** How the user clears the ABORTED latch; every refusal caused by the latch ends with it. */
export const ABORT_HINT = 'press Clear abort in the HUD';

/** The reason every latched operation is refused for. */
export const ABORTED_REFUSAL = `ABORTED is active — ${ABORT_HINT}`;

/** `what` refused because the latch is set, with how to clear it. */
export const refusedWhileAborted = (what: string) => `${what} refused — ${ABORTED_REFUSAL}`;

/** Settings range of the optional auto-clear, in minutes; 0 = off (the default). */
export const ABORT_AUTO_CLEAR_MAX_MIN = 240;
export const DEFAULT_ABORT_AUTO_CLEAR_MIN = 0;

/** Banner text: when the latch was set and, when on, when it clears by itself. */
export function abortBannerText(since: number | null, autoClearMin: number): string {
  const at = since === null ? '' : ` since ${new Date(since).toLocaleTimeString()}`;
  const auto = autoClearMin > 0 ? ` · auto-clears after ${autoClearMin} min` : '';
  return `ABORTED${at} — every automated operation is refused until you clear it${auto}`;
}

/**
 * Clears the latch `minutes` after it was set (the latch refuses everything, so that time is idle).
 * 0 keeps it latched until the user clears it; a change of the setting restarts the count.
 */
export function useAbortAutoClear(aborted: boolean, minutes: number, clear: (reason: string) => void): void {
  const clearRef = useRef(clear);
  clearRef.current = clear;
  useEffect(() => {
    if (!aborted || minutes <= 0) return undefined;
    const timer = setTimeout(() => clearRef.current(`auto-cleared after ${minutes} min idle`), minutes * 60_000);
    return () => clearTimeout(timer);
  }, [aborted, minutes]);
}
