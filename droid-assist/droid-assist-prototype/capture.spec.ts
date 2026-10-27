import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScreenCapture, displayMediaCapture, nativeCapture } from './capture.js';
import type { NativeCaptureApi, NativeFrame } from './electron/capture-api.js';

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

function stubApi() {
  const calls: { onFrame?: (f: NativeFrame) => void; onError?: (m: string) => void } = {};
  const api: NativeCaptureApi = {
    startCapture: vi.fn(async (_ms, onFrame, onError) => {
      calls.onFrame = onFrame;
      calls.onError = onError;
    }),
    setCaptureInterval: vi.fn(),
    stopCapture: vi.fn(),
    listDisplays: vi.fn(async () => []),
    selectDisplay: vi.fn(),
  };
  return { api, calls };
}

const handlers = () => ({ onImage: vi.fn(), onLost: vi.fn() });

afterEach(() => vi.restoreAllMocks());

describe('createScreenCapture', () => {
  it('falls back to getDisplayMedia outside Electron', () => {
    expect(createScreenCapture(undefined).kind).toBe('display-media');
  });

  it('uses native capture under Electron and never prompts', async () => {
    const getDisplayMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia }, configurable: true });
    const { api } = stubApi();
    const capture = createScreenCapture(api);
    expect(capture.kind).toBe('native');
    await capture.start(1000, handlers());
    expect(api.startCapture).toHaveBeenCalledWith(1000, expect.any(Function), expect.any(Function));
    expect(getDisplayMedia).not.toHaveBeenCalled();
  });
});

describe('nativeCapture', () => {
  it('maps pushed frames to images at native resolution', async () => {
    const { api, calls } = stubApi();
    const h = handlers();
    await nativeCapture(api).start(250, h);
    calls.onFrame!({ time: 5, url: 'data:image/jpeg;base64,AA', pixels: new Uint8Array(320 * 180 * 4), srcW: 2560, srcH: 1440 });
    const image = h.onImage.mock.calls[0][0];
    expect(image.data.width).toBe(320);
    expect(image.data.height).toBe(180);
    expect(image.srcW).toBe(2560);
    expect(image.srcH).toBe(1440);
    expect(image.url).toBe('data:image/jpeg;base64,AA');
  });

  it('reports a main-process capture error as lost', async () => {
    const { api, calls } = stubApi();
    const h = handlers();
    await nativeCapture(api).start(1000, h);
    calls.onError!('Screen gone');
    expect(h.onLost).toHaveBeenCalledWith('Screen gone');
  });

  it('forwards interval changes and stop', () => {
    const { api } = stubApi();
    const capture = nativeCapture(api);
    capture.setInterval(250);
    capture.stop();
    expect(api.setCaptureInterval).toHaveBeenCalledWith(250);
    expect(api.stopCapture).toHaveBeenCalled();
  });
});

describe('displayMediaCapture', () => {
  it('reports the share ending as lost', async () => {
    const track = Object.assign(new EventTarget(), { stop: vi.fn() });
    const stream = { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
    const media = { getDisplayMedia: vi.fn(async () => stream) } as unknown as MediaDevices;
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const h = handlers();
    await displayMediaCapture(media).start(1000, h);
    track.dispatchEvent(new Event('ended'));
    expect(h.onLost).toHaveBeenCalledWith('Screen share ended');
  });

  it('rejects when the user denies the share', async () => {
    const media = { getDisplayMedia: vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError'); }) } as unknown as MediaDevices;
    await expect(displayMediaCapture(media).start(1000, handlers())).rejects.toThrow('denied');
  });
});
