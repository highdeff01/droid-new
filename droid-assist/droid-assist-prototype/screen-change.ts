import type { Frame } from './types.js';
import { parseJsonReply } from './ai.js';
import type { AskFn } from './ai.js';
import type { Box, Thought } from './assist-ai.js';
import { boundingBox, diffCells, largestCluster } from './drift.js';

/** Default minimum size (cells of the 16x9 grid) of the largest changed cluster that counts as a material change. */
export const DEFAULT_CHANGE_CELLS = 6;

/** The region that changed between two frames, when the change is material. */
export interface ScreenChange {
  box: Box;
  /** Cells in the largest changed cluster. */
  cells: number;
}

/**
 * The material change between `prev` and `cur`: the bounding box of the largest connected
 * cluster of changed cells, or null when that cluster is smaller than `minCells`.
 */
export function detectChange(prev: ImageData, cur: ImageData, minCells: number): ScreenChange | null {
  const cells = largestCluster(diffCells(prev, cur));
  if (cells.length < Math.max(1, minCells)) return null;
  const box = boundingBox(cells);
  return box ? { box, cells: cells.length } : null;
}

/** What the model says changed and whether it affects the current plan. */
export interface ChangeAssessment extends Thought {
  /** Kind of change: popup, navigation, dialog, content, error or other. */
  kind: string;
  /** One sentence describing what the screen now shows. */
  summary: string;
  /** True when the pending step can no longer run as planned. */
  stale: boolean;
  /** How the change affects the plan. */
  effect: string;
}

/** The plan context the responder judges a change against. */
export interface PlanContext {
  goal: string;
  /** The pending step, described ("click \"Play button\" at (50%, 60%)"), or null when nothing is pending. */
  next: string | null;
}

/** The summary of an assessment whose reply described no change: said plainly, never left blank. */
export const NO_SUMMARY = 'No summary could be produced — the AI described no change';

const KINDS = new Set(['popup', 'navigation', 'dialog', 'content', 'error', 'other']);
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

export const CHANGE_SYSTEM = 'You are Droid Assist\'s screen-change responder. The first image is the full screen with the changed region boxed in red; the second is a zoomed crop of that region. Reply ONLY with JSON {"kind":"popup"|"navigation"|"dialog"|"content"|"error"|"other","summary":string,"stale":boolean,"effect":string}.';

/**
 * Asks the model what changed in the boxed region and whether it affects the current plan.
 * `full` is the frame with the region boxed, `crop` the zoomed region.
 */
export async function assessChange(ask: AskFn, full: Frame, crop: Frame, change: ScreenChange, plan: PlanContext): Promise<ChangeAssessment> {
  const { box } = change;
  const { content, thinking } = await ask({
    system: CHANGE_SYSTEM,
    prompt: `The screen changed in the region x=${pct(box.x)}..${pct(box.x + box.w)}, y=${pct(box.y)}..${pct(box.y + box.h)}.\nGoal: ${plan.goal || '(none)'}\nNext planned step: ${plan.next ?? '(none)'}\nWhat changed on the screen, and does it affect the current plan? Set stale=true only if the next planned step can no longer run as planned (its target moved, is covered or gone, or the screen is somewhere else).`,
    frame: full,
    crops: [crop],
    json: true,
  });
  const r = parseJsonReply(content);
  const summary = (typeof r.summary === 'string' ? r.summary.trim() : '') || NO_SUMMARY;
  const kind = KINDS.has(String(r.kind)) ? String(r.kind) : 'other';
  return { kind, summary, stale: r.stale === true, effect: String(r.effect ?? '').trim(), thinking };
}

/** One-line text of an assessment, for the timeline and the activity log. */
export function changeText(a: ChangeAssessment): string {
  return `[${a.kind}] ${a.summary} — ${a.stale ? 'PLAN STALE' : 'plan still valid'}${a.effect ? `: ${a.effect}` : ''}`;
}
