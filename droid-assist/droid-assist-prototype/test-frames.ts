import type { Frame } from './types.js';

/** Sample-buffer size of a Frame's drift data. */
const W = 320;
const H = 180;

/** Test fixture: a dark 320×180 buffer with a bright 12×12 square (and a marker beside it) centred on each box, in sample pixels. */
export function boxImage(boxes: Array<{ x: number; y: number }>): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const box = boxes.some((b) => Math.abs(x - b.x) < 6 && Math.abs(y - b.y) < 6);
      const mark = boxes.some((b) => x - b.x >= 6 && x - b.x < 10 && Math.abs(y - b.y) < 3);
      const v = box ? 240 : mark ? 140 : 20;
      data.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}

/** Test fixture: a 1920×1080 desktop Frame around `data`. */
export const boxFrame = (data: ImageData, id = 1): Frame => ({ id, time: id, url: `data:image/jpeg;base64,${id}`, data, srcW: 1920, srcH: 1080, source: 'desktop' });
