import type { Frame } from './types.js';
import type { Box } from './assist-ai.js';
import { SAMPLE_H, SAMPLE_W } from './drift.js';
import { fullUrl } from './grounding.js';

/** Largest output side of a snip, in pixels. */
export const SNIP_MAX_PX = 4096;
/** Most snips kept in the gallery (newest first, in memory). */
export const SNIP_LIMIT = 30;

/** Output pixel size of a snip. */
export interface SnipSize {
  w: number;
  h: number;
}

/** Who took a snip: the AI or an agent on request, the user's drag, or a reroute re-identifying a target. */
export type SnipBy = 'ai' | 'user' | 'reroute';

/** One snipped region kept in the gallery. */
export interface Snip {
  id: string;
  time: number;
  /** Normalized region of the snipped display. */
  box: Box;
  /** The crop at its output size; srcW/srcH/origin give its native pixels on the desktop. */
  frame: Frame;
  by: SnipBy;
  label: string;
  /** The display it came from; null = the captured one. */
  displayId: string | null;
}

/** The image a snip is cut from: a live frame or a native full-resolution grab of a display. */
export type SnipSource = Pick<Frame, 'url' | 'full' | 'srcW' | 'srcH' | 'originX' | 'originY' | 'source'>;

/** A parsed `/snip` request. */
export interface SnipRequest {
  box: Box;
  size: Partial<SnipSize>;
  displayId: string | null;
}

export const SNIP_USAGE = 'Usage: /snip x,y,w,h [WxH] [display <id>] — region as fractions 0..1 (or percents), e.g. /snip 0.1,0.2,0.3,0.25 800x, /snip 50,0,50,50 display 2';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const side = (v: number) => Math.min(SNIP_MAX_PX, Math.max(1, Math.round(v)));

/** A region kept inside the screen; null when nothing of it is left. */
export function clampBox(box: Box): Box | null {
  const x = clamp01(box.x);
  const y = clamp01(box.y);
  const w = Math.min(box.w, 1 - x);
  const h = Math.min(box.h, 1 - y);
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/**
 * Output size of a snip of `box` on a srcW×srcH screen: both sides given are exact, one given
 * keeps the region's aspect, none is the region's native pixels; each side is 1..SNIP_MAX_PX.
 */
export function snipSize(box: Box, srcW: number, srcH: number, size: Partial<SnipSize> = {}): SnipSize {
  const nw = Math.max(1, box.w * srcW);
  const nh = Math.max(1, box.h * srcH);
  if (size.w && size.h) return { w: side(size.w), h: side(size.h) };
  if (size.w) return { w: side(size.w), h: side((size.w * nh) / nw) };
  if (size.h) return { w: side((size.h * nw) / nh), h: side(size.h) };
  return { w: side(nw), h: side(nh) };
}

/** A /snip value: a fraction 0..1, or a percent when above 1. */
const fraction = (v: string) => {
  const n = Number(v);
  return n > 1 ? n / 100 : n;
};

const SNIP_PATTERN = /^(\S+?),(\S+?),(\S+?),(\S+?)(?:\s+(\d*)x(\d*))?(?:\s+display\s+(\S+))?$/i;

/** Parses `/snip` arguments: `x,y,w,h [WxH] [display <id>]`; an error carries the usage. */
export function parseSnipArgs(text: string): SnipRequest | { error: string } {
  const m = SNIP_PATTERN.exec(text.trim().replace(/\s*,\s*/g, ','));
  if (!m) return { error: SNIP_USAGE };
  const values = m.slice(1, 5).map(fraction);
  if (values.some((v) => !Number.isFinite(v) || v < 0)) return { error: SNIP_USAGE };
  const box = clampBox({ x: values[0], y: values[1], w: values[2], h: values[3] });
  if (!box) return { error: `The region is empty — ${SNIP_USAGE}` };
  const size: Partial<SnipSize> = {};
  if (m[5]) size.w = Number(m[5]);
  if (m[6]) size.h = Number(m[6]);
  return { box, size, displayId: m[7] ?? null };
}

/** Prepends a snip to the gallery, keeping the newest SNIP_LIMIT. */
export const addSnip = (list: Snip[], snip: Snip): Snip[] => [snip, ...list.filter((s) => s.id !== snip.id)].slice(0, SNIP_LIMIT);

/** One-line description of a snip's region and size. */
export const snipText = (s: Snip) => `${s.label}: (${(s.box.x * 100).toFixed(1)}%, ${(s.box.y * 100).toFixed(1)}%) ${(s.box.w * 100).toFixed(1)}% × ${(s.box.h * 100).toFixed(1)}% → ${s.frame.srcW}×${s.frame.srcH}px native`;

async function decode(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** A canvas of `w`×`h` with the `box` region of `img` drawn into it. */
function drawRegion(img: HTMLImageElement, box: Box, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  canvas.getContext('2d', { willReadFrequently: true })!.drawImage(img, box.x * W, box.y * H, box.w * W, box.h * H, 0, 0, w, h);
  return canvas;
}

/**
 * Crops `box` out of the source's highest-resolution image at `size` (see snipSize). The Frame's
 * srcW/srcH/origin are the region's native pixels on the desktop, so a point on the snip maps back to the screen.
 */
export async function snipFrame(src: SnipSource, box: Box, id: number, size: Partial<SnipSize> = {}): Promise<Frame> {
  const img = await decode(fullUrl(src as Frame));
  const out = snipSize(box, src.srcW, src.srcH, size);
  const url = drawRegion(img, box, out.w, out.h).toDataURL('image/jpeg', 0.9);
  const data = drawRegion(img, box, SAMPLE_W, SAMPLE_H).getContext('2d')!.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
  return {
    id,
    time: Date.now(),
    url,
    full: url,
    data,
    srcW: Math.round(box.w * src.srcW),
    srcH: Math.round(box.h * src.srcH),
    originX: Math.round((src.originX ?? 0) + box.x * src.srcW),
    originY: Math.round((src.originY ?? 0) + box.y * src.srcH),
    source: src.source,
  };
}
