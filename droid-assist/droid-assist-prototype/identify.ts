import type { Frame } from './types.js';
import type { Box, Thought } from './assist-ai.js';
import { GRID_PROMPT, gridRef, replyPoint } from './grid.js';
import { VIEW_H, VIEW_W, parseJsonReply } from './ai.js';
import type { AiReply, AskRequest } from './ai.js';
import { boxCenter, mapCell, mapCells, type MappedElement } from './element-map-studio.js';

/** Fallback limits: identification stops after this many failed tries or this much time, whichever comes first. */
export const IDENTIFY_TRIES = 3;
export const IDENTIFY_WINDOW_MS = 30_000;

/** Why an identification request was sent. */
export type IdentifyReason = 'not_clicked' | 'not_accepted' | 'not_proposed' | 'new_element' | 'changing_element';

const REASON_TEXT: Record<IdentifyReason, string> = {
  not_clicked: 'a planned element was not clicked',
  not_accepted: 'a planned element was not accepted by verification',
  not_proposed: 'the planner proposed no location for a planned element',
  new_element: 'a new element appeared on screen',
  changing_element: 'an element keeps changing on screen',
};

/** Colour statistics of a region of the drift buffer. */
export interface ColorStats {
  /** Mean colour, 0..255 per channel. */
  mean: [number, number, number];
  /** Most common colour after quantizing each channel to 32 levels (bucket centre). */
  dominant: [number, number, number];
  /** Share of pixels in the dominant bucket, 0..1. */
  dominantShare: number;
  /** Luminance standard deviation, 0..1 (flat vs busy region). */
  contrast: number;
}

type Point = { x: number; y: number };

/** Colour statistics of `box` (normalized) in a pixel buffer; an empty region reads as black. */
export function regionStats(data: ImageData, box: Box): ColorStats {
  const x0 = Math.max(0, Math.floor(box.x * data.width));
  const y0 = Math.max(0, Math.floor(box.y * data.height));
  const x1 = Math.min(data.width, Math.max(x0 + 1, Math.ceil((box.x + box.w) * data.width)));
  const y1 = Math.min(data.height, Math.max(y0 + 1, Math.ceil((box.y + box.h) * data.height)));
  const sum = [0, 0, 0];
  const buckets = new Map<number, number>();
  let lumSum = 0;
  let lumSq = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * data.width + x) * 4;
      const [r, g, b] = [data.data[i], data.data[i + 1], data.data[i + 2]];
      sum[0] += r;
      sum[1] += g;
      sum[2] += b;
      const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      buckets.set(k, (buckets.get(k) ?? 0) + 1);
      const l = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      lumSum += l;
      lumSq += l * l;
      n++;
    }
  }
  if (!n) return { mean: [0, 0, 0], dominant: [0, 0, 0], dominantShare: 0, contrast: 0 };
  let topKey = 0;
  let topCount = 0;
  buckets.forEach((c, k) => {
    if (c > topCount) {
      topKey = k;
      topCount = c;
    }
  });
  const centre = (v: number) => (v << 3) + 4;
  const mean = sum.map((s) => Math.round(s / n)) as [number, number, number];
  const lumMean = lumSum / n;
  return {
    mean,
    dominant: [centre((topKey >> 10) & 31), centre((topKey >> 5) & 31), centre(topKey & 31)],
    dominantShare: topCount / n,
    contrast: Math.sqrt(Math.max(0, lumSq / n - lumMean * lumMean)),
  };
}

const hex = (c: [number, number, number]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Distance from an element's centre to a mapped element's centre, in native pixels. */
export interface MappedDistance {
  name: string;
  px: number;
  dxPx: number;
  dyPx: number;
}

/** Distances from `p` to every mapped element's centre, nearest first, in native pixels of a srcW x srcH screen. */
export function mappedDistances(p: Point, mapped: MappedElement[], srcW: number, srcH: number): MappedDistance[] {
  return mapped.map((m) => {
    const c = boxCenter(m.box);
    const dxPx = Math.round((c.x - p.x) * srcW);
    const dyPx = Math.round((c.y - p.y) * srcH);
    return { name: m.name, dxPx, dyPx, px: Math.round(Math.hypot(dxPx, dyPx)) };
  }).sort((a, b) => a.px - b.px);
}

/** Everything known about the element to identify. */
export interface IdentifyInput {
  reason: IdentifyReason;
  /** The element's boundary box on the screen (normalized). */
  box: Box;
  /** A crop of the region (sent as the request's image). */
  crop: Frame;
  /** The full frame the region was taken from (for its pixel buffer and native size). */
  frame: Frame;
  /** The element's name or text when known; omitted otherwise (never invented). */
  text?: string;
  mapped: MappedElement[];
}

/** The element's characteristics and coordinate help, as prompt lines. */
export function characteristics(input: IdentifyInput): string[] {
  const { box, frame, mapped, text } = input;
  const c = boxCenter(box);
  const s = regionStats(frame.data, box);
  const wPx = Math.round(box.w * frame.srcW);
  const hPx = Math.round(box.h * frame.srcH);
  const dist = mappedDistances(c, mapped, frame.srcW, frame.srcH);
  return [
    `Boundary box: x=${box.x.toFixed(3)}, y=${box.y.toFixed(3)}, w=${box.w.toFixed(3)}, h=${box.h.toFixed(3)} (fractions), = (${Math.round(box.x * frame.srcW)}, ${Math.round(box.y * frame.srcH)})px to (${Math.round((box.x + box.w) * frame.srcW)}, ${Math.round((box.y + box.h) * frame.srcH)})px`,
    `Size: ${wPx}x${hPx}px on a ${frame.srcW}x${frame.srcH} screen`,
    `Colour: mean ${hex(s.mean)}, dominant ${hex(s.dominant)} (${(s.dominantShare * 100).toFixed(0)}% of the region), contrast ${s.contrast.toFixed(3)}`,
    ...(text?.trim() ? [`Text / label: "${text.trim()}"`] : []),
    `Grid: centre in planner cell ${gridRef(c)}, top-left ${gridRef(box)}; element-map cells ${mapCells(box)} (centre ${mapCell(c)})`,
    dist.length
      ? `Distance from mapped elements (nearest first): ${dist.map((d) => `"${d.name}" ${d.px}px (dx ${d.dxPx >= 0 ? '+' : ''}${d.dxPx}, dy ${d.dyPx >= 0 ? '+' : ''}${d.dyPx})`).join('; ')}`
      : 'Distance from mapped elements: none mapped yet',
  ];
}

/** System prompt of the identification request: the reply contract. */
export const IDENTIFY_SYSTEM = `You are Droid Assist's element identifier. You see a crop of one region of the user's screen (the full screenshot is ${VIEW_W}x${VIEW_H}) and its measured characteristics.
${GRID_PROMPT}
Identify the element and give its clickable centre on the FULL screen. Use the boundary box, the grid cells and the distances from the user's mapped elements to measure it.
Reply ONLY with JSON {"found":boolean,"name":string,"cell":string,"cx":number,"cy":number,"reason":string}. Set found=false if the element cannot be identified.`;

/** The identification request for one element; `feedback` says why the previous proposal failed. */
export function identifyRequest(input: IdentifyInput, feedback?: string): AskRequest {
  const lines = [`Why: ${REASON_TEXT[input.reason]}.`, ...characteristics(input), ...(feedback ? [`Your previous proposal failed: ${feedback}`] : [])];
  return { system: IDENTIFY_SYSTEM, prompt: lines.join('\n'), frame: input.crop, context: [], json: true };
}

/** The model's identification: the element's name and a point on the full screen, or not found. */
export type Identification = ({ found: true; name: string; x: number; y: number; reason: string } | { found: false; reason: string }) & Thought;

/** Parses an identification reply; throws AiError on a malformed reply. */
export function parseIdentification(reply: AiReply, fallbackName: string): Identification {
  const r = parseJsonReply(reply.content);
  const reason = String(r.reason ?? '');
  if (r.found !== true) return { found: false, reason, thinking: reply.thinking };
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : fallbackName;
  return { found: true, name, ...replyPoint(r), reason, thinking: reply.thinking };
}

/** One verification of a proposed point by the agent test. */
export type AgentCheck = { ok: true; x: number; y: number; message: string } | { ok: false; message: string };

/** What the identify-and-verify loop needs from its host. */
export interface IdentifyLoop {
  /** Sends the identification request (with feedback after a failure). */
  identify: (feedback?: string) => Promise<Identification>;
  /** The agent test: dry-run move to the point and verify it against the live frame. */
  verify: (id: Extract<Identification, { found: true }>) => Promise<AgentCheck>;
  /** True once the run was aborted: no further try is started. */
  aborted: () => boolean;
  log: (message: string, tone: 'info' | 'ok' | 'warn' | 'error') => void;
  now?: () => number;
  tries?: number;
  windowMs?: number;
}

/** The loop's result: the verified, corrected point, or why it gave up. */
export type IdentifyOutcome = { verified: true; name: string; x: number; y: number; tries: number } | { verified: false; tries: number; reason: string };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Resolves `p`, or rejects with a timeout once `ms` pass. */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('the 30-second identification window ran out')), Math.max(0, ms));
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** One try: identify, then verify; resolves the accepted point or the failure feedback. */
async function oneTry(loop: IdentifyLoop, feedback: string | undefined): Promise<{ id: Extract<Identification, { found: true }>; check: Extract<AgentCheck, { ok: true }> } | { feedback: string }> {
  const id = await loop.identify(feedback);
  if (!id.found) return { feedback: `the element was not identified (${id.reason || 'no reason given'})` };
  const check = await loop.verify(id);
  return check.ok ? { id, check } : { feedback: `"${id.name}" at ${gridRef(id)} failed the agent test: ${check.message}` };
}

/**
 * Identification with an agent test: up to `tries` (3) identify → verify rounds within
 * `windowMs` (30 s), whichever limit is reached first. A verified proposal resolves with the
 * agent's corrected point; otherwise it logs plainly and resolves unverified — it never throws,
 * so the caller continues with its current plan. An abort stops before the next try.
 */
export async function identifyAndVerify(loop: IdentifyLoop): Promise<IdentifyOutcome> {
  const now = loop.now ?? Date.now;
  const tries = loop.tries ?? IDENTIFY_TRIES;
  const deadline = now() + (loop.windowMs ?? IDENTIFY_WINDOW_MS);
  let feedback: string | undefined;
  let k = 0;
  for (; k < tries; k++) {
    if (loop.aborted()) return giveUp(loop, k, 'aborted');
    const left = deadline - now();
    if (left <= 0) break;
    try {
      const r = await withDeadline(oneTry(loop, feedback), left);
      if ('id' in r) {
        loop.log(`Identified "${r.id.name}" on try ${k + 1}/${tries} — agent test passed: ${r.check.message}`, 'ok');
        return { verified: true, name: r.id.name, x: r.check.x, y: r.check.y, tries: k + 1 };
      }
      feedback = r.feedback;
      loop.log(`Try ${k + 1}/${tries}: ${feedback}`, 'warn');
    } catch (error) {
      feedback = errorText(error);
      loop.log(`Try ${k + 1}/${tries} failed: ${feedback}`, 'error');
    }
  }
  return giveUp(loop, k, feedback ?? 'no proposal');
}

function giveUp(loop: IdentifyLoop, tries: number, last: string): IdentifyOutcome {
  const reason = `Could not find or verify the element after ${tries} tries / ${Math.round((loop.windowMs ?? IDENTIFY_WINDOW_MS) / 1000)}s (last: ${last}) — giving up; the main process continues with its current plan`;
  loop.log(reason, 'error');
  return { verified: false, tries, reason };
}

/** A changed region seen by the frame-diff watcher and when it changed. */
export interface ChangeHit {
  box: Box;
  times: number[];
}

/** Frames a region must change in (within CHANGE_WINDOW_MS) to count as constantly changing. */
export const CHANGE_HITS = 3;
export const CHANGE_WINDOW_MS = 10_000;

/** Intersection over union of two boxes. */
export function iou(a: Box, b: Box): number {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = w * h;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Records a changed region: a region overlapping a tracked one (IoU >= 0.5) adds a hit to it,
 * otherwise it is tracked anew ('new'). 'constant' when that region changed CHANGE_HITS times
 * within CHANGE_WINDOW_MS (its hits are then reset so it is reported once per streak).
 */
export function noteChange(hits: ChangeHit[], box: Box, now: number): { hits: ChangeHit[]; kind: 'new' | 'repeat' | 'constant' } {
  const fresh = hits.map((h) => ({ ...h, times: h.times.filter((t) => now - t <= CHANGE_WINDOW_MS) })).filter((h) => h.times.length);
  const match = fresh.find((h) => iou(h.box, box) >= 0.5);
  if (!match) return { hits: [{ box, times: [now] }, ...fresh].slice(0, 12), kind: 'new' };
  match.box = box;
  match.times.push(now);
  if (match.times.length < CHANGE_HITS) return { hits: fresh, kind: 'repeat' };
  match.times = [];
  return { hits: fresh, kind: 'constant' };
}

/** True when a region overlapping `box` was sent for identification within IDENTIFY_WINDOW_MS. */
export const recentlySent = (sent: Array<{ box: Box; time: number }>, box: Box, now: number) => sent.some((s) => now - s.time < IDENTIFY_WINDOW_MS && iou(s.box, box) >= 0.5);

/** A crop of `box` out of the frame's display image, as a JPEG frame (at least 32px a side). */
export async function cropFrame(live: Frame, box: Box): Promise<Frame> {
  const img = new Image();
  img.src = live.url;
  await img.decode();
  const sw = Math.max(1, box.w * img.naturalWidth);
  const sh = Math.max(1, box.h * img.naturalHeight);
  const scale = Math.max(1, 32 / Math.min(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas.getContext('2d')!.drawImage(img, box.x * img.naturalWidth, box.y * img.naturalHeight, sw, sh, 0, 0, canvas.width, canvas.height);
  return { ...live, url: canvas.toDataURL('image/jpeg', 0.85) };
}
