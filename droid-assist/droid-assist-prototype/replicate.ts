import type { FamiliarElement, Frame } from './types.js';
import type { Box } from './assist-ai.js';
import type { AiReply, AskRequest } from './ai.js';
import { parseJsonReply } from './ai.js';
import { boxCenter, type MappedElement } from './element-map-studio.js';
import { regionStats } from './identify.js';
import { uid } from './planner.js';

/** An element the AI replicated by itself: the snipped crop and every characteristic extracted from it. */
export interface Replica {
  id: string;
  name: string;
  /** Boundary on the screen, normalized 0..1. */
  box: Box;
  /** The snipped region (JPEG data URL). */
  crop: string;
  /** Native pixel size and bounds on a srcW x srcH screen. */
  size: { w: number; h: number };
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** Mean and dominant colours as #rrggbb, dominant share 0..1 and luminance contrast 0..1. */
  colors: { mean: string; dominant: string; dominantShare: number; contrast: number };
  /** Text read from the region; empty when none. */
  text: string;
  time: number;
}

const hex = (c: [number, number, number]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Extracts a replica of `box` from the frame: the snipped crop (from the snip tool), size, colours, text and bounds. */
export function extractReplica(frame: Frame, box: Box, crop: string, name: string, text = '', time = Date.now()): Replica {
  const s = regionStats(frame.data, box);
  const bounds = { x0: Math.round(box.x * frame.srcW), y0: Math.round(box.y * frame.srcH), x1: Math.round((box.x + box.w) * frame.srcW), y1: Math.round((box.y + box.h) * frame.srcH) };
  return {
    id: uid('rep'),
    name: name.trim() || 'Replicated element',
    box,
    crop,
    size: { w: bounds.x1 - bounds.x0, h: bounds.y1 - bounds.y0 },
    bounds,
    colors: { mean: hex(s.mean), dominant: hex(s.dominant), dominantShare: s.dominantShare, contrast: s.contrast },
    text: text.trim(),
    time,
  };
}

/** The replica as a mapped element (its boundary) for the element map and grounding. */
export const replicaToMapped = (r: Replica, frame?: Frame): MappedElement => ({ id: r.id, name: r.name, box: r.box, mappedAt: r.time, ...(frame ? { frame } : {}) });

/** The replica as a familiar element (its centre and crop patch). */
export const replicaToFamiliar = (r: Replica): FamiliarElement => ({ id: r.id, name: r.name, ...boxCenter(r.box), patch: r.crop, lastSeen: r.time });

/** One log / briefing line describing the replica. */
export const replicaLine = (r: Replica) =>
  `[Replica] "${r.name}" ${r.size.w}x${r.size.h}px at (${r.bounds.x0}, ${r.bounds.y0})..(${r.bounds.x1}, ${r.bounds.y1})px, colours mean ${r.colors.mean} dominant ${r.colors.dominant} (${(r.colors.dominantShare * 100).toFixed(0)}%), contrast ${r.colors.contrast.toFixed(3)}${r.text ? `, text "${r.text}"` : ''}`;

/** System prompt asking the model to name and read the snipped element. */
export const REPLICATE_SYSTEM = 'You are Droid Assist\'s element replicator. The image is a snipped region of the user\'s screen. Name the UI element it shows and read any text on it. Reply ONLY with JSON {"name":string,"text":string}.';

/** The naming request for a snipped region: the crop plus a hint of what the AI was looking for. */
export const replicateRequest = (crop: Frame, hint: string): AskRequest => ({ system: REPLICATE_SYSTEM, prompt: `The element to replicate: ${hint}`, frame: crop, json: true });

/** The name and text from a naming reply; the hint names it when the reply gives no name. Throws AiParseError on a reply without JSON. */
export function parseReplicaNaming(reply: AiReply, hint: string): { name: string; text: string } {
  const r = parseJsonReply(reply.content);
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : hint.trim();
  return { name, text: typeof r.text === 'string' ? r.text.trim() : '' };
}
