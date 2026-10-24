/** IPC channel names shared by the Electron main process and the preload script. */
export const CAPTURE_CHANNELS = {
  start: 'capture:start',
  setInterval: 'capture:set-interval',
  stop: 'capture:stop',
  frame: 'capture:frame',
  error: 'capture:error',
} as const;

/** Width/height of the display JPEG every native frame carries. */
export const VIEW_W = 960;
export const VIEW_H = 540;

/** Width/height of the RGBA pixel buffer every native frame carries (matches drift.ts SAMPLE_W/H). */
export const SAMPLE_W = 320;
export const SAMPLE_H = 180;

/** One screenshot the main process pushed to the renderer. */
export interface NativeFrame {
  time: number;
  /** JPEG data URL, VIEW_W × VIEW_H. */
  url: string;
  /** RGBA pixels, SAMPLE_W × SAMPLE_H. */
  pixels: Uint8Array;
  /** Physical pixel size of the captured display (what the desktop bridge clicks in). */
  srcW: number;
  srcH: number;
}

/** The API the preload exposes on `window.droidNative` when running under Electron. */
export interface NativeCaptureApi {
  /** Starts the main-process capture loop; frames and the terminal error arrive on the callbacks. */
  startCapture(intervalMs: number, onFrame: (frame: NativeFrame) => void, onError: (message: string) => void): Promise<void>;
  /** Changes the interval of the running loop. */
  setCaptureInterval(intervalMs: number): void;
  /** Stops the loop and drops the callbacks. */
  stopCapture(): void;
}
