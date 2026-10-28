import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ABORT_HINT, abortBannerText, refusedWhileAborted, useAbortAutoClear } from './abort-latch.js';
import { DEFAULT_SETTINGS, useAssist, type AssistEngine } from './use-assist.js';
import { loadSettings } from './storage.js';
import { AbortBanner } from './hud.js';

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

/** jsdom has no image decoding or canvas: a decodable Image and a 2D context that draws nothing. */
class FakeImage {
  src = '';
  naturalWidth = 640;
  naturalHeight = 360;
  decode(): Promise<void> {
    return this.src.startsWith('data:image/') ? Promise.resolve() : Promise.reject(new Error('cannot decode'));
  }
}

const fakeContext = {
  drawImage: () => {},
  getImageData: (_x: number, _y: number, w: number, h: number) => new ImageData(new Uint8ClampedArray(w * h * 4), w, h),
};

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,BB');
});

afterEach(() => {
  cleanup();
  delete window.droidMainBridge;
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** The minimal fake AssistEngine AbortBanner reads: aborted state, the auto-clear setting, and invoke(). */
function fakeEngine(aborted: boolean): AssistEngine {
  return {
    aborted,
    abortedAt: Date.now(),
    settings: { abortAutoClearMin: 0 },
    invoke: vi.fn(async () => ({ ok: true })),
  } as unknown as AssistEngine;
}

describe('abort latch', () => {
  it('ABORT_HINT names the HUD control', () => {
    expect(ABORT_HINT).toBe('press Clear abort in the HUD');
  });

  it('refusedWhileAborted names what was refused and how to clear it', () => {
    expect(refusedWhileAborted('Retest')).toBe('Retest refused — ABORTED is active — press Clear abort in the HUD');
  });

  it('abortBannerText with auto-clear off mentions ABORTED but not auto-clear', () => {
    const text = abortBannerText(null, 0);
    expect(text).toContain('ABORTED');
    expect(text).not.toContain('auto-clears');
  });

  it('abortBannerText with auto-clear on names the minutes', () => {
    expect(abortBannerText(Date.now(), 30)).toContain('auto-clears after 30 min');
  });

  describe('useAbortAutoClear', () => {
    it('minutes 0 never clears, even after 10 hours', () => {
      vi.useFakeTimers();
      const clear = vi.fn();
      renderHook(() => useAbortAutoClear(true, 0, clear));
      act(() => vi.advanceTimersByTime(10 * 60 * 60_000));
      expect(clear).not.toHaveBeenCalled();
    });

    it('minutes 5: not called just before 5 minutes, called exactly once by 5 minutes', () => {
      vi.useFakeTimers();
      const clear = vi.fn();
      renderHook(() => useAbortAutoClear(true, 5, clear));
      act(() => vi.advanceTimersByTime(5 * 60_000 - 1));
      expect(clear).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(clear).toHaveBeenCalledTimes(1);
      expect(clear.mock.calls[0][0]).toContain('5 min');
    });

    it('aborted false never clears', () => {
      vi.useFakeTimers();
      const clear = vi.fn();
      renderHook(() => useAbortAutoClear(false, 5, clear));
      act(() => vi.advanceTimersByTime(60 * 60_000));
      expect(clear).not.toHaveBeenCalled();
    });

    it('a rerender to aborted false before expiry cancels the timer', () => {
      vi.useFakeTimers();
      const clear = vi.fn();
      const { rerender } = renderHook(({ aborted }) => useAbortAutoClear(aborted, 5, clear), { initialProps: { aborted: true } });
      act(() => vi.advanceTimersByTime(4 * 60_000));
      rerender({ aborted: false });
      act(() => vi.advanceTimersByTime(60 * 60_000));
      expect(clear).not.toHaveBeenCalled();
    });
  });

  describe('engine', () => {
    it('triggerAbort sets the latch with a timestamp and logs the HUD hint', async () => {
      const { result } = renderHook(() => useAssist());
      await act(async () => {});
      act(() => result.current.triggerAbort('stop button'));
      expect(result.current.aborted).toBe(true);
      expect(typeof result.current.abortedAt).toBe('number');
      expect(result.current.log.some((l) => l.source === 'Safety' && l.message.includes('press Clear abort in the HUD'))).toBe(true);
    });

    it('clearAbort releases the latch', async () => {
      const { result } = renderHook(() => useAssist());
      await act(async () => {});
      act(() => result.current.triggerAbort('stop button'));
      act(() => result.current.clearAbort());
      expect(result.current.aborted).toBe(false);
      expect(result.current.abortedAt).toBeNull();
    });
  });

  describe('settings', () => {
    it('defaults the auto-clear minutes to off', () => {
      expect(DEFAULT_SETTINGS.abortAutoClearMin).toBe(0);
    });

    it('restores a valid stored auto-clear minutes', () => {
      localStorage.setItem('droid-assist.settings', JSON.stringify({ abortAutoClearMin: 30 }));
      expect(loadSettings(DEFAULT_SETTINGS).abortAutoClearMin).toBe(30);
    });

    it('keeps the default for an out-of-range stored value', () => {
      localStorage.setItem('droid-assist.settings', JSON.stringify({ abortAutoClearMin: 999 }));
      expect(loadSettings(DEFAULT_SETTINGS).abortAutoClearMin).toBe(0);
    });
  });

  describe('AbortBanner', () => {
    it('shows an alert naming ABORTED while the latch is set', () => {
      const { getByRole } = render(<AbortBanner engine={fakeEngine(true)} />);
      expect(getByRole('alert').textContent).toContain('ABORTED');
    });

    it('clicking Clear abort invokes guard.clearAbort', () => {
      const engine = fakeEngine(true);
      const { getByRole } = render(<AbortBanner engine={engine} />);
      fireEvent.click(getByRole('button', { name: 'Clear abort' }));
      expect(engine.invoke).toHaveBeenCalledWith('guard.clearAbort');
    });

    it('renders nothing while not aborted', () => {
      const { container } = render(<AbortBanner engine={fakeEngine(false)} />);
      expect(container.firstChild).toBeNull();
    });
  });
});
