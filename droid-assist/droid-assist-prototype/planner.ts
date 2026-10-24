import type { Frame, SavedCard, StepAction, WorkflowStep } from './types.js';

let seq = 0;
/** A short unique id. */
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

const STOP = new Set(['the', 'and', 'for', 'with', 'then', 'step', 'steps', 'click', 'button', 'main', 'action']);
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));

/**
 * How much of `goal` is covered by `text` (0..1): the share of the goal's meaningful
 * words found in the candidate. Short goals match long saved descriptions well.
 */
export function similarity(goal: string, text: string): number {
  const A = words(goal);
  const B = words(text);
  if (!A.size || !B.size) return 0;
  let both = 0;
  A.forEach((w) => B.has(w) && both++);
  return both / A.size;
}

/** The saved card most similar to `text`, when it is close enough to reuse. */
export function findSimilar(text: string, cards: SavedCard[], min = 0.5): SavedCard | null {
  let best: SavedCard | null = null;
  let score = min;
  for (const card of cards) {
    const s = similarity(text, `${card.name} ${card.description} ${card.steps.map((st) => st.name).join(' ')}`);
    if (s >= score) {
      best = card;
      score = s;
    }
  }
  return best;
}

/**
 * Finds the most button-like (saturated, bright) region of a frame — a fallback target
 * when the planner has no learned coordinates. Returns normalized coordinates.
 */
export function findSalientTarget(frame: Frame, exclude?: { x: number; y: number; w: number; h: number } | null) {
  const { data, width, height } = frame.data;
  let best = { score: 0, x: 0.5, y: 0.5 };
  for (let y = 6; y < height - 20; y += 4) {
    for (let x = 6; x < width - 6; x += 4) {
      const nx = x / width;
      const ny = y / height;
      if (exclude && nx >= exclude.x && nx <= exclude.x + exclude.w && ny >= exclude.y && ny <= exclude.y + exclude.h) continue;
      let score = 0;
      for (let dy = -4; dy <= 4; dy += 2) {
        for (let dx = -4; dx <= 4; dx += 2) {
          const i = ((y + dy) * width + x + dx) * 4;
          const max = Math.max(data[i], data[i + 1], data[i + 2]);
          const min = Math.min(data[i], data[i + 1], data[i + 2]);
          score += (max - min) * (max / 255);
        }
      }
      if (score > best.score) best = { score, x: nx, y: ny };
    }
  }
  // Grow to the full extent of the similarly-colored region and aim at its center,
  // not the edge pixel that happened to score highest.
  const at = (x: number, y: number) => ((Math.round(y) * width + Math.round(x)) * 4);
  const seed = at(best.x * width, best.y * height);
  const same = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const i = at(x, y);
    return Math.abs(data[i] - data[seed]) + Math.abs(data[i + 1] - data[seed + 1]) + Math.abs(data[i + 2] - data[seed + 2]) < 60;
  };
  const sx = best.x * width;
  const sy = best.y * height;
  let l = sx, r = sx, t = sy, b = sy;
  while (same(l - 1, sy)) l--;
  while (same(r + 1, sy)) r++;
  const cx = (l + r) / 2;
  while (same(cx, t - 1)) t--;
  while (same(cx, b + 1)) b++;
  return { score: best.score, x: cx / width, y: (t + b) / 2 / height };
}

const step = (name: string, action: StepAction, x: number, y: number, extra: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id: uid('step'),
  name,
  action,
  x,
  y,
  status: 'pending',
  ...extra,
});

/** A plan the assistant proposes, with where it came from. */
export interface PlanResult {
  steps: WorkflowStep[];
  source: string;
}

/**
 * Auto-fills a workflow from a goal: reuses a similar saved workflow when one exists,
 * otherwise assembles steps from the goal's intent and the live screen.
 */
export function planFromGoal(goal: string, cards: SavedCard[], frame: Frame | null, popup: { x: number; y: number; w: number; h: number } | null): PlanResult {
  const similar = findSimilar(goal, cards);
  if (similar) {
    return {
      source: `Reused saved workflow "${similar.name}" (similar goal)`,
      steps: similar.steps.map((s) => ({ ...s, id: uid('step'), status: 'pending' as const, correctedX: undefined, correctedY: undefined })),
    };
  }
  const g = goal.toLowerCase();
  const out: WorkflowStep[] = [];
  if (/open|launch|start app/.test(g)) out.push(step(`Open ${goal.replace(/.*(open|launch)\s*/i, '') || 'app'}`, 'open_app', 0.05, 0.4));
  if (/game|play|level/.test(g) && frame) {
    const target = findSalientTarget(frame, popup);
    out.push(step('Click the main action button', 'click', target.x, target.y, { refFrame: frame }));
  }
  const typed = goal.match(/(?:type|write)\s+"([^"]+)"/i);
  if (typed) out.push(step(`Type "${typed[1]}"`, 'type', 0.5, 0.5, { text: typed[1] }));
  const searched = goal.match(/search\s+(?:for\s+)?(.+)/i);
  if (searched) out.push(step(`Search: ${searched[1]}`, 'search', 0.5, 0.05, { text: searched[1] }));
  const calc = goal.match(/(?:calc|calculate)\s+([0-9+\-*/(). ]+)/i);
  if (calc) out.push(step(`Calculate ${calc[1].trim()}`, 'calc', 0.5, 0.5, { text: calc[1].trim() }));
  if (/music|media|video/.test(g)) out.push(step('Play / pause media', 'media', 0.5, 0.5));
  if (!out.length && frame) {
    const target = findSalientTarget(frame, popup);
    out.push(step('Click the most prominent control', 'click', target.x, target.y, { refFrame: frame }));
  }
  return { steps: out, source: 'Assembled from the goal and the live screen' };
}

/** A generated name + description for a workflow. */
export function generateCard(steps: WorkflowStep[], goal: string): { name: string; description: string } {
  const verbs = Array.from(new Set(steps.map((s) => s.action))).join(', ');
  const name = goal.trim() ? goal.trim().replace(/^\w/, (c) => c.toUpperCase()).slice(0, 48) : `Workflow (${steps.length} steps)`;
  return { name, description: `${steps.length} step(s): ${verbs || 'empty'}. ${steps.map((s) => s.name).slice(0, 3).join(' → ')}` };
}

/** Safely evaluates a plain arithmetic expression; null when it is not one. */
export function calculate(expr: string): number | null {
  if (!/^[0-9+\-*/(). ]+$/.test(expr)) return null;
  try {
    const value = Function(`"use strict"; return (${expr});`)() as unknown;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
