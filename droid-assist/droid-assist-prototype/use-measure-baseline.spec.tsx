import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMeasure, NEED_BASELINE, type MeasureDeps } from './use-measure.js';
import { CalibrationPrompt } from './hud.js';
import type { AssistEngine } from './use-assist.js';
import type { Frame } from './types.js';

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

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

const frame = (srcW: number, srcH: number): Frame => ({ id: 1, time: 0, url: '', data: {} as ImageData, srcW, srcH, source: 'desktop' });

/** Renders useMeasure with fake deps like use-measure.spec.ts, plus a spy onNeedBaseline. */
function measureHook() {
  const framesRef = { current: [frame(1000, 500)] };
  const addLog = vi.fn();
  const onNeedBaseline = vi.fn();
  const deps: MeasureDeps = {
    frames: framesRef.current,
    framesRef,
    elementMap: () => [{ name: 'Files icon', x: 0.1, y: 0.2, origin: 'annotation' }, { name: 'Game icon', x: 0.4, y: 0.6, origin: 'flow' }],
    addLog,
    rescale: vi.fn(),
    onNeedBaseline,
  };
  const hook = renderHook(() => useMeasure(deps));
  return { ...hook, framesRef, addLog, onNeedBaseline };
}

describe('baseline prompt', () => {
  it('NEED_BASELINE names the action', () => {
    expect(NEED_BASELINE).toBe('Set the calibration baseline now on a known-good screen');
  });

  describe('no baseline', () => {
    it('two consecutive failures pause correction and prompt once', () => {
      const { result, addLog, onNeedBaseline } = measureHook();
      act(() => result.current.noteGrounding({ ok: false }));
      act(() => result.current.noteGrounding({ ok: false }));
      expect(result.current.needsBaseline).toBe(true);
      expect(onNeedBaseline).toHaveBeenCalledTimes(1);
      expect(onNeedBaseline).toHaveBeenCalledWith(NEED_BASELINE);
      const pausedLines = addLog.mock.calls.filter((c) => c[0] === 'Calibration' && c[1].includes('paused') && c[1].includes(NEED_BASELINE));
      expect(pausedLines).toHaveLength(1);
      expect(pausedLines[0][2]).toBe('warn');
      expect(addLog.mock.calls.some((c) => c[2] === 'error')).toBe(false);
      expect(addLog.mock.calls.some((c) => c[1].includes('not possible'))).toBe(false);
    });

    it('four more failures still prompt only once and log only once', () => {
      const { result, addLog, onNeedBaseline } = measureHook();
      act(() => result.current.noteGrounding({ ok: false }));
      act(() => result.current.noteGrounding({ ok: false }));
      for (let i = 0; i < 4; i++) act(() => result.current.noteGrounding({ ok: false }));
      expect(onNeedBaseline).toHaveBeenCalledTimes(1);
      expect(addLog.mock.calls.filter((c) => c[0] === 'Calibration' && c[1].includes('paused'))).toHaveLength(1);
    });

    it('setBaseline with a captured frame resumes correction', () => {
      const { result, addLog } = measureHook();
      act(() => result.current.noteGrounding({ ok: false }));
      act(() => result.current.noteGrounding({ ok: false }));
      act(() => result.current.setBaseline());
      expect(result.current.needsBaseline).toBe(false);
      expect(addLog.mock.calls.some((c) => c[0] === 'Calibration' && c[1].includes('resumed'))).toBe(true);
    });
  });

  describe('with a baseline', () => {
    it('two more failures recalibrate instead of re-prompting', () => {
      const { result, addLog, onNeedBaseline } = measureHook();
      act(() => result.current.setBaseline());
      onNeedBaseline.mockClear();
      act(() => result.current.noteGrounding({ ok: false }));
      act(() => result.current.noteGrounding({ ok: false }));
      expect(addLog.mock.calls.some((c) => c[0] === 'Calibration' && /Recalibrat/.test(c[1]))).toBe(true);
      expect(onNeedBaseline).not.toHaveBeenCalled();
    });
  });

  it('openCalibration turns the ruler on and brings its panel into view', () => {
    const panel = document.createElement('div');
    panel.setAttribute('data-panel-id', 'ruler');
    panel.scrollIntoView = vi.fn();
    document.body.appendChild(panel);
    const { result } = measureHook();
    act(() => result.current.openCalibration());
    expect(result.current.on).toBe(true);
    expect(panel.scrollIntoView).toHaveBeenCalled();
    panel.remove();
  });

  describe('CalibrationPrompt', () => {
    const engineWith = (needsBaseline: boolean, openCalibration = vi.fn(), setBaseline = vi.fn()): AssistEngine =>
      ({ ruler: { needsBaseline, openCalibration, setBaseline } } as unknown as AssistEngine);

    it('shows an alert naming NEED_BASELINE while a baseline is needed', () => {
      const { getByRole } = render(<CalibrationPrompt engine={engineWith(true)} />);
      expect(getByRole('alert').textContent).toContain(NEED_BASELINE);
    });

    it('Open calibration calls openCalibration', () => {
      const openCalibration = vi.fn();
      const { getByRole } = render(<CalibrationPrompt engine={engineWith(true, openCalibration)} />);
      fireEvent.click(getByRole('button', { name: 'Open calibration' }));
      expect(openCalibration).toHaveBeenCalled();
    });

    it('Set baseline now calls setBaseline', () => {
      const setBaseline = vi.fn();
      const { getByRole } = render(<CalibrationPrompt engine={engineWith(true, vi.fn(), setBaseline)} />);
      fireEvent.click(getByRole('button', { name: 'Set baseline now' }));
      expect(setBaseline).toHaveBeenCalled();
    });

    it('renders nothing while no baseline is needed', () => {
      const { container } = render(<CalibrationPrompt engine={engineWith(false)} />);
      expect(container.firstChild).toBeNull();
    });
  });
});
