import type { Frame, MonitorMode, ScreenSource } from './types.js';
import { SAMPLE_H, SAMPLE_W } from './drift.js';
import { captureBridgeScreen } from './bridge.js';

/** Screenshot returned by the Electron shell's native capture (exposed by its preload script). */
export interface NativeScreenshot {
  /** PNG/JPEG data URL of the captured screen or window. */
  image: string;
}

declare global {
  interface Window {
    /** Present only when running inside the Droid Assist Electron shell. */
    droidAssistNative?: { captureScreen(): Promise<NativeScreenshot> };
  }
}

/** Label and fixed interval of each monitor mode; `null` means "use settings.captureMs". */
export const MONITOR_MODES: Record<MonitorMode, { label: string; fixedMs: number | null }> = {
  app: { label: 'App capture & monitor', fixedMs: null },
  background: { label: 'Background monitor & control', fixedMs: 1000 },
  advanced: { label: 'Advanced monitor', fixedMs: 250 },
};

/** Capture interval for a monitor mode. */
export function monitorInterval(mode: MonitorMode, captureMs: number): number {
  return MONITOR_MODES[mode].fixedMs ?? captureMs;
}

/** True when the Electron shell's native capture is available. */
export function nativeCaptureAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.droidAssistNative?.captureScreen === 'function';
}

/** The real capture source for this runtime: native under Electron, else the browser screen share. */
export function realScreenSource(): ScreenSource {
  return nativeCaptureAvailable() ? 'native' : 'screen';
}

/** What each capture source draws from. */
export interface CaptureDeps {
  demoCanvas: HTMLCanvasElement | null;
  video: HTMLVideoElement | null;
  bridgeUrl: string;
}

/** A drawable image of the full source plus its native resolution. */
interface RawCapture {
  src: CanvasImageSource;
  w: number;
  h: number;
}

/** Decodes an image data URL. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Screenshot could not be decoded'));
    img.src = url;
  });
}

async function fromDataUrl(url: string): Promise<RawCapture> {
  const img = await loadImage(url);
  return { src: img, w: img.naturalWidth, h: img.naturalHeight };
}

/** One grabber per source; null means "nothing to capture yet", a throw is a real capture failure. */
const GRABBERS: Record<ScreenSource, (deps: CaptureDeps) => Promise<RawCapture | null>> = {
  demo: async ({ demoCanvas }) => (demoCanvas ? { src: demoCanvas, w: demoCanvas.width, h: demoCanvas.height } : null),
  screen: async ({ video }) => (video?.videoWidth ? { src: video, w: video.videoWidth, h: video.videoHeight } : null),
  bridge: async ({ bridgeUrl }) => {
    const shot = await captureBridgeScreen(bridgeUrl);
    if (!shot.ok || !shot.image) throw new Error(shot.message);
    return fromDataUrl(shot.image);
  },
  native: async () => {
    if (!window.droidAssistNative) throw new Error('Native capture is not available outside the Electron shell');
    return fromDataUrl((await window.droidAssistNative.captureScreen()).image);
  },
};

/** Turns a drawable source into a Frame: a 480×270 JPEG for display plus a sample buffer for drift math. */
export function frameFromSource(src: CanvasImageSource, srcW: number, srcH: number, id: number, source: ScreenSource): Frame {
  const small = document.createElement('canvas');
  small.width = SAMPLE_W;
  small.height = SAMPLE_H;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(src, 0, 0, SAMPLE_W, SAMPLE_H);
  const view = document.createElement('canvas');
  view.width = 480;
  view.height = 270;
  view.getContext('2d')!.drawImage(src, 0, 0, 480, 270);
  return { id, time: Date.now(), url: view.toDataURL('image/jpeg', 0.7), data: sctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H), srcW, srcH, source };
}

/** Captures one frame from `source`. Resolves null when the source has nothing yet; rejects on capture failure. */
export async function grabFrame(source: ScreenSource, deps: CaptureDeps, id: number): Promise<Frame | null> {
  const raw = await GRABBERS[source](deps);
  if (!raw || !raw.w || !raw.h) return null;
  return frameFromSource(raw.src, raw.w, raw.h, id, source);
}
