import type { Frame } from './types.js';
import type { Box } from './assist-ai.js';

/** Width of the zoomed crop as a share of the screen width. */
export const ZOOM_SHARE = 0.18;
/** Pixel size of the square crop the model is shown. */
export const ZOOM_PX = 240;

/**
 * The normalized box of the zoomed crop around `p`: square in screen pixels for an
 * `aspect` (width/height) screen, kept inside the screen.
 */
export function zoomBox(p: { x: number; y: number }, aspect = 16 / 9, share = ZOOM_SHARE): Box {
  const w = share;
  const h = Math.min(1, share * aspect);
  const clamp = (v: number, size: number) => Math.min(1 - size, Math.max(0, v - size / 2));
  return { x: clamp(p.x, w), y: clamp(p.y, h), w, h };
}

/**
 * Crops a zoomed region around `p` out of the live frame's display image and marks the
 * proposed point with a red ring, so the model only has to say whether the target is under it.
 */
export async function zoomFrame(live: Frame, p: { x: number; y: number }): Promise<Frame> {
  const img = new Image();
  img.src = live.url;
  await img.decode();
  const box = zoomBox(p, live.srcW / live.srcH);
  const canvas = document.createElement('canvas');
  canvas.width = ZOOM_PX;
  canvas.height = ZOOM_PX;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, box.x * img.naturalWidth, box.y * img.naturalHeight, box.w * img.naturalWidth, box.h * img.naturalHeight, 0, 0, ZOOM_PX, ZOOM_PX);
  ctx.strokeStyle = '#ff0000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(((p.x - box.x) / box.w) * ZOOM_PX, ((p.y - box.y) / box.h) * ZOOM_PX, 14, 0, Math.PI * 2);
  ctx.stroke();
  return { ...live, url: canvas.toDataURL('image/jpeg', 0.85) };
}

/** Pixel size of the square screenshot patch kept with a familiar element. */
export const PATCH_PX = 48;

/** A small JPEG data URL of the live frame around `p`, for the familiar-elements memory. */
export async function patchAt(live: Frame, p: { x: number; y: number }): Promise<string> {
  const img = new Image();
  img.src = live.url;
  await img.decode();
  const box = zoomBox(p, live.srcW / live.srcH, 0.06);
  const canvas = document.createElement('canvas');
  canvas.width = PATCH_PX;
  canvas.height = PATCH_PX;
  canvas.getContext('2d')!.drawImage(img, box.x * img.naturalWidth, box.y * img.naturalHeight, box.w * img.naturalWidth, box.h * img.naturalHeight, 0, 0, PATCH_PX, PATCH_PX);
  return canvas.toDataURL('image/jpeg', 0.7);
}
