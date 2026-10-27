/** IPC channel names shared by the Electron main process and the preload script. */
export const CAPTURE_CHANNELS = {
  start: 'capture:start',
  setInterval: 'capture:set-interval',
  stop: 'capture:stop',
  frame: 'capture:frame',
  error: 'capture:error',
  displays: 'capture:displays',
  selectDisplay: 'capture:select-display',
} as const;

/** Width/height of the display JPEG every native frame carries. */
export const VIEW_W = 960;
export const VIEW_H = 540;

/** Width/height of the RGBA pixel buffer every native frame carries (matches drift.ts SAMPLE_W/H). */
export const SAMPLE_W = 320;
export const SAMPLE_H = 180;

/** Width/height of the live thumbnail each listed display carries. */
export const THUMB_W = 192;
export const THUMB_H = 108;

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
  /** Physical pixel position of the captured display's top-left on the virtual desktop; absent = 0,0 (a primary at the origin). */
  originX?: number;
  originY?: number;
}

/** A connected display as the renderer's display picker shows it. */
export interface DisplayInfo {
  /** Electron display id, as a string (what the selection persists). */
  id: string;
  label: string;
  /** Physical resolution. */
  width: number;
  height: number;
  primary: boolean;
  /** PNG data URL, THUMB_W × THUMB_H; empty when the display returned no image. */
  thumbnail: string;
}

/** The API the preload exposes on `window.droidNative` when running under Electron. */
export interface NativeCaptureApi {
  /** Starts the main-process capture loop; frames and the terminal error arrive on the callbacks. */
  startCapture(intervalMs: number, onFrame: (frame: NativeFrame) => void, onError: (message: string) => void): Promise<void>;
  /** Changes the interval of the running loop. */
  setCaptureInterval(intervalMs: number): void;
  /** Stops the loop and drops the callbacks. */
  stopCapture(): void;
  /** Every connected display with a fresh thumbnail. */
  listDisplays(): Promise<DisplayInfo[]>;
  /** Chooses the display the loop captures from (null = primary); applies from the next tick. */
  selectDisplay(id: string | null): void;
}
