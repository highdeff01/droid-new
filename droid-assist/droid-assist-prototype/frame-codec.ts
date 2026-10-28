import type { Frame } from './types.js';
import { SAMPLE_H, SAMPLE_W } from './drift.js';

/** A frame as persisted: everything but the pixel buffer, which is rebuilt from the JPEG. */
export type StoredFrame = Omit<Frame, 'data'>;

/** Strips the (non-serialisable) pixel buffer from a frame. */
export function toStoredFrame({ id, time, url, srcW, srcH, source }: Frame): StoredFrame {
  return { id, time, url, srcW, srcH, source };
}

/** Every frame source a persisted frame may come from, so a template recorded on one source replays on another. */
const FRAME_SOURCES: ReadonlySet<unknown> = new Set<Frame['source']>(['demo', 'screen', 'desktop', 'main-app']);

/** True when `v` has the shape of a persisted frame. */
export function isStoredFrame(v: unknown): v is StoredFrame {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  return typeof f.id === 'number' && typeof f.time === 'number' && typeof f.url === 'string' && f.url.startsWith('data:image/')
    && typeof f.srcW === 'number' && typeof f.srcH === 'number' && FRAME_SOURCES.has(f.source);
}

/** Rebuilds a full frame by decoding its JPEG into the 320×180 pixel buffer; null when it cannot be decoded. */
export async function decodeFrame(stored: StoredFrame): Promise<Frame | null> {
  try {
    const img = new Image();
    img.src = stored.url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, SAMPLE_W, SAMPLE_H);
    return { ...stored, data: ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H) };
  } catch {
    return null;
  }
}

/** Decodes every stored frame, dropping the ones that fail. */
export async function decodeFrames(stored: StoredFrame[]): Promise<Frame[]> {
  const frames = await Promise.all(stored.map(decodeFrame));
  return frames.filter((f): f is Frame => f !== null);
}
