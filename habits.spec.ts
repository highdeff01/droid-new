import { describe, expect, it } from 'vitest';
import type { Habit } from './types.js';
import {
  HABIT_LIMIT,
  HABIT_LOW_VALUE_ATTEMPTS,
  HABIT_MIN_ATTEMPTS,
  HABIT_STALE_MS,
  anchoredHabit,
  habitLine,
  isReliable,
  pruneHabits,
  recordOutcome,
  relevantHabits,
  seedFromAnchor,
  strengthenHabit,
  successRate,
} from './habits.js';

const W = 320;
const H = 180;

function image(cx: number, cy: number): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = Math.abs(x - cx) < 6 && Math.abs(y - cy) < 6 ? 240 : x - cx >= 6 && x - cx < 10 && Math.abs(y - cy) < 3 ? 140 : 20;
      data.set([v, v, v, 255], i);
    }
  }
  return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}

describe('recordOutcome', () => {
  it('upserts keyed by normalised target and context', () => {
    let habits = recordOutcome([], { target: 'Save button', context: 'Notepad', success: true });
    habits = recordOutcome(habits, { target: 'save button ', context: 'Word', success: true });
    habits = recordOutcome(habits, { target: 'Save button', context: 'notepad', success: true });
    expect(habits).toHaveLength(2);
    const notepad = habits.find((h) => h.context === 'Notepad')!;
    const word = habits.find((h) => h.context === 'Word')!;
    expect(notepad.attempts).toBe(2);
    expect(word.attempts).toBe(1);
  });

  it('counts attempts and successes and computes successRate', () => {
    let habits = recordOutcome([], { target: 'X', context: 'Y', success: true });
    habits = recordOutcome(habits, { target: 'X', context: 'Y', success: false });
    habits = recordOutcome(habits, { target: 'X', context: 'Y', success: true });
    const h = habits[0];
    expect(h.attempts).toBe(3);
    expect(h.successes).toBe(2);
    expect(successRate(h)).toBeCloseTo(0.667, 2);
  });

  it('successRate of a 0-attempt habit is 0, not NaN', () => {
    const h: Habit = { id: 'h', target: 'Z', context: 'C', attempts: 0, successes: 0, lastUsed: 0, lessons: [], pinned: false };
    expect(successRate(h)).toBe(0);
  });

  it('dedupes the same avoid lesson recorded twice', () => {
    let habits = recordOutcome([], { target: 'T', context: 'C', success: false, avoid: 'banner' });
    habits = recordOutcome(habits, { target: 'T', context: 'C', success: false, avoid: 'banner' });
    const h = habits[0];
    expect(h.attempts).toBe(2);
    expect(h.successes).toBe(0);
    expect(h.lessons.filter((l) => l.text === 'banner')).toHaveLength(1);
  });

  it('attaches both an avoid and an add lesson from the same outcome', () => {
    const habits = recordOutcome([], { target: 'T2', context: 'C2', success: true, avoid: 'a1', add: 'b1' });
    const h = habits[0];
    expect(h.lessons).toHaveLength(2);
    expect(h.lessons.map((l) => l.kind).sort()).toEqual(['add', 'avoid']);
  });

  it('leaves the array unchanged for an empty target', () => {
    const habits: Habit[] = [];
    expect(recordOutcome(habits, { target: '  ', context: 'c', success: true })).toBe(habits);
  });

  it('moves the touched habit to index 0 with lastUsed set to now', () => {
    let habits = recordOutcome([], { target: 'A', context: 'c1', success: true }, 1);
    habits = recordOutcome(habits, { target: 'B', context: 'c2', success: true }, 2);
    const now = 123456;
    habits = recordOutcome(habits, { target: 'A', context: 'c1', success: true }, now);
    expect(habits[0]).toMatchObject({ target: 'A', context: 'c1', lastUsed: now });
  });
});

describe('isReliable', () => {
  const base = (overrides: Partial<Habit>): Habit => ({ id: 'h', target: 't', context: 'c', attempts: 0, successes: 0, lastUsed: 0, lessons: [], pinned: false, ...overrides });

  it('is reliable below HABIT_MIN_ATTEMPTS even at a 0 success rate', () => {
    expect(isReliable(base({ attempts: HABIT_MIN_ATTEMPTS - 1, successes: 0 }))).toBe(true);
  });

  it('is reliable at exactly the threshold rate once judged', () => {
    expect(isReliable(base({ attempts: 4, successes: 2 }))).toBe(true);
  });

  it('is unreliable below the threshold rate once judged', () => {
    expect(isReliable(base({ attempts: 4, successes: 1 }))).toBe(false);
  });
});

describe('pruneHabits', () => {
  const now = 1_000_000_000;
  const base = (overrides: Partial<Habit>): Habit => ({ id: 'h', target: 't', context: 'c', attempts: 0, successes: 0, lastUsed: now, lessons: [], pinned: false, ...overrides });

  it('drops an unpinned habit last used past HABIT_STALE_MS', () => {
    const stale = base({ id: 'stale', lastUsed: now - HABIT_STALE_MS - 1 });
    expect(pruneHabits([stale], now)).toEqual([]);
  });

  it('drops an unpinned low-value habit', () => {
    const lowValue = base({ id: 'low', attempts: HABIT_LOW_VALUE_ATTEMPTS, successes: 0 });
    expect(pruneHabits([lowValue], now)).toEqual([]);
  });

  it('keeps a fresh good habit', () => {
    const good = base({ id: 'good', attempts: 1, successes: 1 });
    expect(pruneHabits([good], now)).toEqual([good]);
  });

  it('keeps a pinned old zero-rate habit', () => {
    const pinnedOld = base({ id: 'pinnedOld', attempts: 10, successes: 0, lastUsed: now - HABIT_STALE_MS - 1, pinned: true });
    expect(pruneHabits([pinnedOld], now)).toEqual([pinnedOld]);
  });

  it('enforces HABIT_LIMIT, keeping the pinned habit and dropping the least recently used unpinned one', () => {
    const count = HABIT_LIMIT + 10;
    const unpinned: Habit[] = Array.from({ length: count }, (_, i) => base({ id: `u${i}`, lastUsed: now - i, attempts: 1, successes: 1 }));
    const pinned = base({ id: 'pinned', pinned: true, attempts: 5, successes: 0, lastUsed: now - 1_000_000 });
    const result = pruneHabits([...unpinned, pinned], now);
    expect(result).toHaveLength(HABIT_LIMIT);
    expect(result.some((h) => h.id === 'pinned')).toBe(true);
    expect(result.some((h) => h.id === `u${count - 1}`)).toBe(false);
  });
});

describe('auto-application', () => {
  it('relevantHabits returns only the reliable same-context habit sharing a goal word', () => {
    const reliableMatch: Habit = { id: 'r1', target: 'Save button', context: 'Notepad', attempts: 5, successes: 5, lastUsed: 1, lessons: [], pinned: false };
    const unreliable: Habit = { id: 'r2', target: 'Save button', context: 'Notepad', attempts: 4, successes: 0, lastUsed: 1, lessons: [], pinned: false };
    const otherContext: Habit = { id: 'r3', target: 'Save button', context: 'Word', attempts: 5, successes: 5, lastUsed: 1, lessons: [], pinned: false };
    const unrelatedTarget: Habit = { id: 'r4', target: 'Open file', context: 'Notepad', attempts: 5, successes: 5, lastUsed: 1, lessons: [], pinned: false };
    const result = relevantHabits('save the document', 'notepad', [reliableMatch, unreliable, otherContext, unrelatedTarget]);
    expect(result).toEqual([reliableMatch]);
  });

  it('habitLine reports the target, success count and rate percent', () => {
    const h: Habit = { id: 'h', target: 'Save button', context: 'Notepad', attempts: 5, successes: 5, lastUsed: 1, lessons: [], pinned: false };
    const line = habitLine(h);
    expect(line).toContain('Save button');
    expect(line).toContain('5/5 succeeded');
    expect(line).toContain('100%');
  });

  it('seedFromAnchor finds the remembered patch near its drifted position', () => {
    const habits = strengthenHabit([], 'Save button', 'Notepad', image(100, 60), { x: 100 / W, y: 60 / H });
    const anchor = habits[0].anchor!;
    const result = seedFromAnchor(anchor, image(110, 66));
    expect(result).not.toBeNull();
    expect(Math.abs(result!.x * W - 110)).toBeLessThanOrEqual(2);
    expect(Math.abs(result!.y * H - 66)).toBeLessThanOrEqual(2);
  });

  it('seedFromAnchor returns null on an all-white frame', () => {
    const habits = strengthenHabit([], 'Save button', 'Notepad', image(100, 60), { x: 100 / W, y: 60 / H });
    const anchor = habits[0].anchor!;
    const blank = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255), colorSpace: 'srgb' } as ImageData;
    expect(seedFromAnchor(anchor, blank)).toBeNull();
  });

  it('anchoredHabit is null for an unreliable habit even with an anchor', () => {
    let habits = recordOutcome([], { target: 'Save button', context: 'Notepad', success: false });
    habits = recordOutcome(habits, { target: 'Save button', context: 'Notepad', success: false });
    habits = recordOutcome(habits, { target: 'Save button', context: 'Notepad', success: false });
    habits = recordOutcome(habits, { target: 'Save button', context: 'Notepad', success: false });
    habits = strengthenHabit(habits, 'Save button', 'Notepad', image(100, 60), { x: 100 / W, y: 60 / H });
    expect(anchoredHabit(habits, 'Save button', 'Notepad')).toBeNull();
  });

  it('strengthenHabit leaves attempts unchanged', () => {
    let habits = recordOutcome([], { target: 'Save button', context: 'Notepad', success: true });
    const before = habits[0].attempts;
    habits = strengthenHabit(habits, 'Save button', 'Notepad', image(100, 60), { x: 100 / W, y: 60 / H });
    expect(habits[0].attempts).toBe(before);
  });
});
