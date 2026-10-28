import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultBridgeMode, inBrowser, LISTEN_NEEDS_DESKTOP } from './main-bridge.js';
import { useAssist } from './use-assist.js';
import { SettingsPanel } from './panels.js';
import type { AssistEngine } from './use-assist.js';
import type { ListenHandlers, ListenOptions, MainBridgeNativeApi } from './electron/main-bridge-api.js';

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

/** A fake Electron listener on window.droidMainBridge, as installMainBridge in use-assist-main-bridge.spec.ts. */
function installMainBridge() {
  const state: { handlers?: ListenHandlers; options?: ListenOptions } = {};
  const api: MainBridgeNativeApi = {
    listen: vi.fn(async (options: ListenOptions, handlers: ListenHandlers) => {
      state.options = options;
      state.handlers = handlers;
    }),
    send: vi.fn(async () => true),
    stop: vi.fn(),
  };
  window.droidMainBridge = api;
  return state;
}

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

/** Wraps useAssist() so SettingsPanel can be rendered against the real engine. */
function SettingsHost() {
  const engine = useAssist();
  return <SettingsPanel engine={engine} />;
}

describe('browser dial-mode suggestion', () => {
  describe('inBrowser / defaultBridgeMode', () => {
    it('inBrowser is true with no installed listener', () => {
      expect(inBrowser()).toBe(true);
    });

    it('inBrowser is false with a fake listener installed', () => {
      installMainBridge();
      expect(inBrowser()).toBe(false);
    });

    it('defaultBridgeMode is dial in a browser', () => {
      expect(defaultBridgeMode()).toBe('dial');
    });

    it('defaultBridgeMode is listen with a listener installed', () => {
      installMainBridge();
      expect(defaultBridgeMode()).toBe('listen');
    });
  });

  describe('engine defaults', () => {
    it('no stored settings in a browser default to dial, with no listen error', async () => {
      const { result } = renderHook(() => useAssist());
      await act(async () => {});
      expect(result.current.settings.mainBridgeMode).toBe('dial');
      expect(result.current.mainBridge.lastError).not.toBe(LISTEN_NEEDS_DESKTOP);
    });

    it('no stored settings with a listener installed default to listen', async () => {
      installMainBridge();
      const { result } = renderHook(() => useAssist());
      await act(async () => {});
      expect(result.current.settings.mainBridgeMode).toBe('listen');
    });

    it('a stored listen mode in a browser stays listen and reports the plain error', async () => {
      localStorage.setItem('droid-assist.settings', JSON.stringify({ mainBridgeMode: 'listen' }));
      const { result } = renderHook(() => useAssist());
      await act(async () => {});
      expect(result.current.settings.mainBridgeMode).toBe('listen');
      expect(result.current.mainBridge.status).toBe('error');
      expect(result.current.mainBridge.lastError).toBe(LISTEN_NEEDS_DESKTOP);
    });
  });

  describe('SettingsPanel', () => {
    it('in a browser with stored listen mode, shows the notice and a switch-to-dial button that updates storage', async () => {
      localStorage.setItem('droid-assist.settings', JSON.stringify({ mainBridgeMode: 'listen' }));
      const { getByRole, queryByRole } = render(<SettingsHost />);
      await act(async () => {});
      expect(document.body.textContent).toContain('Listen mode needs the Droid Assist desktop app');
      const button = getByRole('button', { name: 'Switch to dial mode' });
      fireEvent.click(button);
      expect(queryByRole('button', { name: 'Switch to dial mode' })).toBeNull();
      expect(JSON.parse(localStorage.getItem('droid-assist.settings')!).mainBridgeMode).toBe('dial');
    });

    it('with a listener installed and stored listen mode, shows no switch-to-dial button', async () => {
      installMainBridge();
      localStorage.setItem('droid-assist.settings', JSON.stringify({ mainBridgeMode: 'listen' }));
      const { queryByRole } = render(<SettingsHost />);
      await act(async () => {});
      expect(queryByRole('button', { name: 'Switch to dial mode' })).toBeNull();
    });
  });
});
