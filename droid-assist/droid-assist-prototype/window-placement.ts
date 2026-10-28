import type { NativeWindowApi, WindowState } from './electron/window-api.js';
import { PLACEMENT_UNSUPPORTED, type PlacementCommand } from './operations.js';

declare global {
  interface Window {
    /** Exposed by the Electron preload; undefined in a plain browser. */
    droidWindow?: NativeWindowApi;
  }
}

/** What the App-placement agent did: whether placement is supported, and the window state after it. */
export interface Placement {
  ok: boolean;
  supported: boolean;
  state: WindowState | null;
  message: string;
}

/** One line of a window state. */
export const windowLine = (s: WindowState) =>
  `assist window ${s.minimized ? 'minimized (stepped aside)' : s.visible ? 'visible' : 'hidden'}${s.focused ? ', focused' : ''}${s.alwaysOnTop ? ', always on top' : ''} at ${s.bounds.x},${s.bounds.y} ${s.bounds.width}×${s.bounds.height}`;

const DONE: Record<PlacementCommand, string> = {
  aside: 'Stepped the assist window aside — the target app is in front',
  back: 'Brought the assist window back',
  state: 'Window state',
};

/**
 * Runs one placement command through the Electron window API; in a browser (no API) it is an honest
 * unsupported answer, never a pretend success. An IPC failure is reported as a failure.
 */
export async function placeWindow(command: PlacementCommand, api: NativeWindowApi | undefined = typeof window === 'undefined' ? undefined : window.droidWindow): Promise<Placement> {
  if (!api) return { ok: false, supported: false, state: null, message: PLACEMENT_UNSUPPORTED };
  const run = { aside: () => api.stepAside(), back: () => api.restore(), state: () => api.state() }[command];
  try {
    const state = await run();
    return { ok: true, supported: true, state, message: `${DONE[command]}: ${windowLine(state)}` };
  } catch (error) {
    return { ok: false, supported: true, state: null, message: `Window placement failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
