import type { NativeFrame } from './capture-api.js';

/** Where a capture loop delivers its output. */
export interface CaptureSink {
  frame(frame: NativeFrame): void;
  /** Called once, when a grab fails; the loop has stopped. */
  error(message: string): void;
}

/** A running main-process capture loop. */
export interface CaptureLoop {
  setInterval(intervalMs: number): void;
  stop(): void;
}

/** Shortest interval the loop accepts (the 0.25 s advanced monitor). */
export const MIN_INTERVAL_MS = 250;

/**
 * Self-scheduling screenshot loop for the Electron main process. Main-process timers are
 * never throttled when the window is unfocused or minimized, so the interval holds. A tick
 * never overlaps a slow grab: the next one is scheduled `intervalMs` after the previous one
 * started, or at once if the grab took longer. A failed grab stops the loop and reports it.
 */
export function startCaptureLoop(grab: () => Promise<NativeFrame>, sink: CaptureSink, intervalMs: number): CaptureLoop {
  let interval = Math.max(MIN_INTERVAL_MS, intervalMs);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let startedAt = 0;

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(tick, Math.max(0, interval - (Date.now() - startedAt)));
  };

  async function tick() {
    timer = undefined;
    startedAt = Date.now();
    try {
      const frame = await grab();
      if (stopped) return;
      sink.frame(frame);
    } catch (error) {
      if (stopped) return;
      stopped = true;
      sink.error(error instanceof Error ? error.message : String(error));
      return;
    }
    schedule();
  }

  void tick();
  return {
    setInterval(next) {
      interval = Math.max(MIN_INTERVAL_MS, next);
      // A tick waiting on the old interval is re-timed so the new rate applies at once.
      if (timer !== undefined && !stopped) schedule();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/** Converts a BGRA bitmap (Electron's NativeImage.toBitmap layout) to RGBA in a new buffer. */
export function bgraToRgba(bgra: Uint8Array): Uint8Array {
  const rgba = new Uint8Array(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2];
    rgba[i + 1] = bgra[i + 1];
    rgba[i + 2] = bgra[i];
    rgba[i + 3] = bgra[i + 3];
  }
  return rgba;
}
