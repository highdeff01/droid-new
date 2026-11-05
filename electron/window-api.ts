/** IPC channel names of the window-placement API, shared by the Electron main process and the preload script. */
export const WINDOW_CHANNELS = {
  state: 'window:state',
  stepAside: 'window:step-aside',
  restore: 'window:restore',
} as const;

/** The assist window's placement as the main process reports it. */
export interface WindowState {
  /** Shown and not minimized. */
  visible: boolean;
  minimized: boolean;
  focused: boolean;
  alwaysOnTop: boolean;
  /** Screen position and size in device-independent pixels. */
  bounds: { x: number; y: number; width: number; height: number };
}

/** The API the preload exposes on `window.droidWindow` when running under Electron. */
export interface NativeWindowApi {
  /** The assist window's current placement. */
  state(): Promise<WindowState>;
  /** Minimizes the assist window so the app behind it (the target) is in front again; resolves the new state. */
  stepAside(): Promise<WindowState>;
  /** Restores, shows and focuses the assist window; resolves the new state. */
  restore(): Promise<WindowState>;
}
