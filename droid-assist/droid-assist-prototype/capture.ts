import type { NativeCaptureApi, NativeFrame } from './electron/capture-api.js';
import type { MonitorMode } from './types.js';
import { SAMPLE_H, SAMPLE_W } from './drift.js';

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

declare global {
  interface Window {
    /** Exposed by the Electron preload; undefined in a plain browser. */
    droidNative?: NativeCaptureApi;
  }
}

/** A captured screen image before it becomes a Frame. */
export interface CapturedImage {
  time: number;
  /** JPEG data URL for display. */
  url: string;
  /** JPEG data URL of the capture at its highest resolution, for the AI view and zoomed crops. */
  full?: string;
  /** SAMPLE_W × SAMPLE_H pixel buffer. */
  data: ImageData;
  srcW: number;
  srcH: number;
}

/** Callbacks a capture delivers to. */
export interface CaptureHandlers {
  onImage(image: CapturedImage): void;
  /** The capture ended or failed on its own; no further images will arrive. */
  onLost(reason: string): void;
}

/** A source of real screen images: Electron native capture or the browser's getDisplayMedia. */
export interface ScreenCapture {
  /** Human-readable name for the log. */
  readonly kind: 'native' | 'display-media';
  /** Begins capturing every `intervalMs`; rejects when capture cannot start. */
  start(intervalMs: number, handlers: CaptureHandlers): Promise<void>;
  setInterval(intervalMs: number): void;
  /** Stops capturing; onLost is not called for a requested stop. */
  stop(): void;
}

function toImage(frame: NativeFrame): CapturedImage {
  const data = new ImageData(Uint8ClampedArray.from(frame.pixels), SAMPLE_W, SAMPLE_H);
  return { time: frame.time, url: frame.url, full: frame.url, data, srcW: frame.srcW, srcH: frame.srcH };
}

/** Electron capture: the main process screenshots the display and pushes frames, unthrottled. */
export function nativeCapture(api: NativeCaptureApi): ScreenCapture {
  return {
    kind: 'native',
    start: (intervalMs, handlers) => api.startCapture(intervalMs, (frame) => handlers.onImage(toImage(frame)), (reason) => handlers.onLost(reason)),
    setInterval: (intervalMs) => api.setCaptureInterval(intervalMs),
    stop: () => api.stopCapture(),
  };
}

/** Widest full-resolution JPEG a frame keeps for the model (enough to zoom sidebar text). */
export const FULL_MAX_W = 1920;

/** The source drawn at its own resolution (capped at FULL_MAX_W wide) as a JPEG data URL. */
export function fullJpeg(src: CanvasImageSource, srcW: number, srcH: number): string {
  const scale = Math.min(1, FULL_MAX_W / srcW);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(srcW * scale));
  canvas.height = Math.max(1, Math.round(srcH * scale));
  canvas.getContext('2d')!.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

/** Draws a video frame into an image: a 480×270 display JPEG, the full-resolution JPEG and the sample buffer. */
function grabVideo(video: HTMLVideoElement): CapturedImage | null {
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  if (!srcW || !srcH) return null;
  const small = document.createElement('canvas');
  small.width = SAMPLE_W;
  small.height = SAMPLE_H;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
  const view = document.createElement('canvas');
  view.width = 480;
  view.height = 270;
  view.getContext('2d')!.drawImage(video, 0, 0, 480, 270);
  return { time: Date.now(), url: view.toDataURL('image/jpeg', 0.7), full: fullJpeg(video, srcW, srcH), data: sctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H), srcW, srcH };
}

/** Browser fallback: getDisplayMedia (shows the share prompt) sampled by a page timer. */
export function displayMediaCapture(media: MediaDevices = navigator.mediaDevices): ScreenCapture {
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let video: HTMLVideoElement | null = null;
  let handlers: CaptureHandlers | null = null;

  const schedule = (intervalMs: number) => {
    clearInterval(timer);
    timer = setInterval(() => {
      const image = video && grabVideo(video);
      if (image) handlers?.onImage(image);
    }, intervalMs);
  };
  const release = () => {
    clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video = null;
    handlers = null;
  };

  return {
    kind: 'display-media',
    async start(intervalMs, next) {
      release();
      stream = await media.getDisplayMedia({ video: true });
      handlers = next;
      video = document.createElement('video');
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        const lost = handlers;
        release();
        lost?.onLost('Screen share ended');
      });
      schedule(intervalMs);
    },
    setInterval: (intervalMs) => { if (stream) schedule(intervalMs); },
    stop: release,
  };
}

/** Picks native capture under Electron, getDisplayMedia otherwise. */
export function createScreenCapture(native: NativeCaptureApi | undefined = window.droidNative): ScreenCapture {
  return native ? nativeCapture(native) : displayMediaCapture();
}
