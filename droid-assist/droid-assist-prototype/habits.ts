import type { Habit, HabitAnchor, HabitLesson } from './types.js';
import { MATCHED } from './drift.js';
import { similarity, uid } from './planner.js';

/** Attempts before a habit's success rate is judged. */
export const HABIT_MIN_ATTEMPTS = 3;
/** A judged habit below this success rate is unreliable: shown, never auto-applied. */
export const HABIT_RELIABLE_RATE = 0.5;
/** Most habits kept. */
export const HABIT_LIMIT = 150;
/** An unpinned habit unused for this long is stale and pruned. */
export const HABIT_STALE_MS = 30 * 24 * 60 * 60 * 1000;
/** An unpinned habit with at least this many attempts… */
export const HABIT_LOW_VALUE_ATTEMPTS = 5;
/** …and a success rate below this is low-value and pruned. */
export const HABIT_LOW_VALUE_RATE = 0.2;
/** Lessons kept per habit. */
export const HABIT_LESSON_LIMIT = 6;
/** Habits sent with one planning ask. */
export const HABIT_CONTEXT_LIMIT = 6;
/** Side of the remembered luminance patch, in drift-buffer pixels. */
export const ANCHOR_PATCH = 16;
/** How far around the remembered point the patch is searched, in drift-buffer pixels. */
export const ANCHOR_RADIUS = 24;

/** One executed step's outcome as a habit update. */
export interface HabitOutcome {
  target: string;
  context: string;
  success: boolean;
  avoid?: string | null;
  add?: string | null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The identity of a habit: its normalised target and context. */
export const habitKey = (target: string, context: string) => `${norm(target)}@${norm(context)}`;

const sameHabit = (h: Habit, target: string, context: string) => habitKey(h.target, h.context) === habitKey(target, context);

/** Successes over attempts; 0 before the first attempt. */
export const successRate = (h: Habit) => (h.attempts ? h.successes / h.attempts : 0);

/** False once a habit has enough attempts and its rate is strictly below HABIT_RELIABLE_RATE. */
export const isReliable = (h: Habit) => h.attempts < HABIT_MIN_ATTEMPTS || successRate(h) >= HABIT_RELIABLE_RATE;

/** A fresh habit for a target in a context. */
const newHabit = (target: string, context: string, now: number): Habit => ({ id: uid('habit'), target: target.trim(), context: context.trim(), attempts: 0, successes: 0, lastUsed: now, lessons: [], pinned: false });

/** `lessons` with the given ones first; one per kind+text (case-insensitive), at most HABIT_LESSON_LIMIT. */
function mergeLessons(lessons: HabitLesson[], added: HabitLesson[]): HabitLesson[] {
  const seen = new Set<string>();
  return [...added, ...lessons].filter((l) => {
    const key = `${l.kind}:${norm(l.text)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, HABIT_LESSON_LIMIT);
}

/** Applies `patch` to the habit for (target, context), creating it first; the touched habit moves to the front. */
function upsert(habits: Habit[], target: string, context: string, now: number, patch: (h: Habit) => Habit): Habit[] {
  const found = habits.find((h) => sameHabit(h, target, context));
  const next = patch({ ...(found ?? newHabit(target, context, now)), lastUsed: now });
  return pruneHabits([next, ...habits.filter((h) => h !== found)], now);
}

/** Records one executed step: counts the attempt (and success) and attaches its avoid/add lessons. */
export function recordOutcome(habits: Habit[], o: HabitOutcome, now = Date.now()): Habit[] {
  if (!o.target.trim()) return habits;
  const lessons: HabitLesson[] = [
    ...(o.avoid?.trim() ? [{ kind: 'avoid' as const, text: o.avoid.trim(), time: now }] : []),
    ...(o.add?.trim() ? [{ kind: 'add' as const, text: o.add.trim(), time: now }] : []),
  ];
  return upsert(habits, o.target, o.context, now, (h) => ({
    ...h,
    attempts: h.attempts + 1,
    successes: h.successes + (o.success ? 1 : 0),
    lessons: mergeLessons(h.lessons, lessons),
  }));
}

const lum = (d: Uint8ClampedArray, i: number) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;

/** Sample-pixel centre of a normalized point, kept far enough inside the frame for a patch. */
function center(img: ImageData, p: { x: number; y: number }, size: number) {
  const half = size >> 1;
  return {
    cx: Math.min(img.width - half - 1, Math.max(half, Math.round(p.x * img.width))),
    cy: Math.min(img.height - half - 1, Math.max(half, Math.round(p.y * img.height))),
  };
}

/** The luminance patch of `img` around a normalized point. */
export function anchorPatch(img: ImageData, p: { x: number; y: number }, size = ANCHOR_PATCH): number[] {
  const { cx, cy } = center(img, p, size);
  const half = size >> 1;
  const out: number[] = [];
  for (let dy = -half; dy < half; dy++) {
    for (let dx = -half; dx < half; dx++) out.push(Math.round(lum(img.data, ((cy + dy) * img.width + cx + dx) * 4)));
  }
  return out;
}

/** A verified target point strengthens the habit's coordinates (no attempt is counted). */
export function strengthenHabit(habits: Habit[], target: string, context: string, img: ImageData, p: { x: number; y: number }, now = Date.now()): Habit[] {
  if (!target.trim()) return habits;
  const anchor: HabitAnchor = { x: p.x, y: p.y, patch: anchorPatch(img, p), size: ANCHOR_PATCH, time: now };
  return upsert(habits, target, context, now, (h) => ({ ...h, anchor }));
}

/** RMS distance (0..1) between the anchor patch and `img` centred on sample pixel (cx, cy); null when outside. */
function patchDistance(a: HabitAnchor, img: ImageData, cx: number, cy: number): number | null {
  const half = a.size >> 1;
  if (cx - half < 0 || cy - half < 0 || cx + half >= img.width || cy + half >= img.height) return null;
  let sum = 0;
  let k = 0;
  for (let dy = -half; dy < half; dy++) {
    for (let dx = -half; dx < half; dx++) {
      const d = a.patch[k++] - lum(img.data, ((cy + dy) * img.width + cx + dx) * 4);
      sum += d * d;
    }
  }
  return Math.sqrt(sum / a.patch.length) / 255;
}

/**
 * Drift template match of a habit's remembered patch around its remembered point on `live`.
 * Resolves the best matching normalized point, or null when nothing within MATCHED is found.
 */
export function seedFromAnchor(a: HabitAnchor, live: ImageData, radius = ANCHOR_RADIUS): { x: number; y: number; distance: number } | null {
  const { cx, cy } = center(live, a, a.size);
  let best = { d: Infinity, x: cx, y: cy };
  for (let dy = -radius; dy <= radius; dy += 2) {
    for (let dx = -radius; dx <= radius; dx += 2) {
      const d = patchDistance(a, live, cx + dx, cy + dy);
      if (d !== null && d < best.d) best = { d, x: cx + dx, y: cy + dy };
    }
  }
  return best.d <= MATCHED ? { x: best.x / live.width, y: best.y / live.height, distance: best.d } : null;
}

/** The reliable habit with remembered coordinates for (target, context), or null. */
export function anchoredHabit(habits: Habit[], target: string, context: string): Habit | null {
  return habits.find((h) => sameHabit(h, target, context) && !!h.anchor && isReliable(h)) ?? null;
}

/** Pinned habits always stay; unpinned ones go when stale or low-value, then the least recently used beyond HABIT_LIMIT. */
export function pruneHabits(habits: Habit[], now = Date.now()): Habit[] {
  const lowValue = (h: Habit) => h.attempts >= HABIT_LOW_VALUE_ATTEMPTS && successRate(h) < HABIT_LOW_VALUE_RATE;
  const keep = (h: Habit) => h.pinned || (now - h.lastUsed <= HABIT_STALE_MS && !lowValue(h));
  const kept = habits.filter(keep);
  const room = Math.max(0, HABIT_LIMIT - kept.filter((h) => h.pinned).length);
  const recent = new Set(kept.filter((h) => !h.pinned).sort((a, b) => b.lastUsed - a.lastUsed).slice(0, room));
  return kept.filter((h) => h.pinned || recent.has(h));
}

/** The reliable habits in `context` whose target shares a meaningful word with `goal`, most used first. */
export function relevantHabits(goal: string, context: string, habits: Habit[]): Habit[] {
  return habits
    .filter((h) => isReliable(h) && norm(h.context) === norm(context) && similarity(h.target, goal) > 0)
    .sort((a, b) => b.attempts - a.attempts)
    .slice(0, HABIT_CONTEXT_LIMIT);
}

const ratePct = (h: Habit) => `${Math.round(successRate(h) * 100)}%`;

/** A habit as one planning-context line, with its success rate and lessons. */
export function habitLine(h: Habit): string {
  const where = h.anchor ? `, last good at (${(h.anchor.x * 100).toFixed(1)}%, ${(h.anchor.y * 100).toFixed(1)}%)` : '';
  const lessons = h.lessons.map((l) => `${l.kind} "${l.text}"`).join('; ');
  return `[Habit] "${h.target}"${h.context ? ` in ${h.context}` : ''}: ${h.successes}/${h.attempts} succeeded (${ratePct(h)})${where}${lessons ? ` — ${lessons}` : ''}`;
}

/** Toggles a habit's pin. */
export const togglePin = (habits: Habit[], id: string) => habits.map((h) => (h.id === id ? { ...h, pinned: !h.pinned } : h));
