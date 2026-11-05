import { describe, expect, it, vi } from 'vitest';
import { placeWindow, windowLine } from './window-placement.js';
import { PLACEMENT_UNSUPPORTED } from './operations.js';
import type { NativeWindowApi, WindowState } from './electron/window-api.js';

const state = (over: Partial<WindowState> = {}): WindowState => ({
  visible: true,
  minimized: false,
  focused: true,
  alwaysOnTop: false,
  bounds: { x: 10, y: 20, width: 800, height: 600 },
  ...over,
});

describe('placeWindow', () => {
  it('returns the unsupported message when no native window API is present', async () => {
    const result = await placeWindow('state', undefined);
    expect(result).toEqual({ ok: false, supported: false, state: null, message: PLACEMENT_UNSUPPORTED });
  });

  it('calls stepAside on a fake API for the "aside" command', async () => {
    const after = state({ minimized: true, focused: false });
    const api: NativeWindowApi = {
      state: vi.fn(async () => state()),
      stepAside: vi.fn(async () => after),
      restore: vi.fn(async () => state()),
    };
    const result = await placeWindow('aside', api);
    expect(api.stepAside).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, supported: true, state: after, message: `Stepped the assist window aside — the target app is in front: ${windowLine(after)}` });
  });
});

describe('windowLine', () => {
  it('formats the window state', () => {
    expect(windowLine(state({ minimized: true, focused: false, alwaysOnTop: true }))).toBe('assist window minimized (stepped aside), always on top at 10,20 800×600');
    expect(windowLine(state())).toBe('assist window visible, focused at 10,20 800×600');
  });
});
