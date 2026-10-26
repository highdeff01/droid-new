import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistSettings, FamiliarElement, Habit, LearnedPattern, LogEntry, SavedCard } from './types.js';
import { HABIT_STALE_MS } from './habits.js';
import { LOG_LIMIT, PATTERN_LIMIT, loadCards, loadFamiliar, loadHabits, loadLog, loadPatterns, loadSettings, saveFamiliar, savePatterns, saveCards, saveHabits, saveLog, saveSettings } from './storage.js';
import { FAMILIAR_LIMIT } from './elements.js';
import { DEFAULT_STAGES } from './loop-control.js';

const DEFAULTS: AssistSettings = { gallerySize: 10, checkpoints: 6, captureMs: 500, changeCells: 6, monitorMode: 'app', autoAct: false, aiHelp: true, showTrail: true, showGrid: true, bridgeUrl: '', abortHotkey: 'Shift+Escape', actionBudget: 50, aiUrl: 'https://ai.example/api/chat', aiModel: 'qwen3.5:2b', autoContinue: false, maxIterations: 5, stages: DEFAULT_STAGES };
const entry = (n: number): LogEntry => ({ id: `log_${n}`, time: n, source: 'Test', message: `message ${n}`, tone: 'info' });

describe('settings', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips saved settings', () => {
    const custom = { ...DEFAULTS, bridgeUrl: 'http://127.0.0.1:9000', captureMs: 1250, autoAct: true };
    saveSettings(custom);
    expect(loadSettings(DEFAULTS)).toEqual(custom);
  });

  it('merges a partial object over the defaults', () => {
    localStorage.setItem('droid-assist.settings', '{"bridgeUrl":"http://x"}');
    expect(loadSettings(DEFAULTS)).toEqual({ ...DEFAULTS, bridgeUrl: 'http://x' });
  });

  it('falls back per field on wrong types and out-of-range numbers', () => {
    localStorage.setItem('droid-assist.settings', '{"captureMs":"abc","autoAct":"yes","gallerySize":0,"checkpoints":99,"showTrail":false}');
    expect(loadSettings(DEFAULTS)).toEqual({ ...DEFAULTS, showTrail: false });
  });

  it('returns the defaults for corrupt or non-object JSON', () => {
    for (const raw of ['{', '[1,2]', 'null', '42']) {
      localStorage.setItem('droid-assist.settings', raw);
      expect(loadSettings(DEFAULTS)).toEqual(DEFAULTS);
    }
  });

  it('round-trips loop-control stages and sanitizes a stored stage map', () => {
    saveSettings({ ...DEFAULTS, stages: { ...DEFAULT_STAGES, popup: false, verdict: false } });
    expect(loadSettings(DEFAULTS).stages).toEqual({ ...DEFAULT_STAGES, popup: false, verdict: false });
    localStorage.setItem('droid-assist.settings', '{"stages":{"reflect":false,"drift":"off","nope":false}}');
    expect(loadSettings(DEFAULTS).stages).toEqual({ ...DEFAULT_STAGES, reflect: false });
    localStorage.setItem('droid-assist.settings', '{"stages":[1]}');
    expect(loadSettings(DEFAULTS).stages).toEqual(DEFAULT_STAGES);
  });
});

describe('log', () => {
  beforeEach(() => localStorage.clear());

  it('keeps only the newest LOG_LIMIT entries, newest first', () => {
    const log = Array.from({ length: 250 }, (_, i) => entry(250 - i));
    saveLog(log);
    const loaded = loadLog();
    expect(loaded).toHaveLength(LOG_LIMIT);
    expect(loaded[0]).toEqual(entry(250));
  });

  it('drops invalid entries and tolerates corrupt data', () => {
    localStorage.setItem('droid-assist.log', JSON.stringify([null, 5, entry(1), { ...entry(2), tone: 'loud' }]));
    expect(loadLog()).toEqual([entry(1)]);
    localStorage.setItem('droid-assist.log', '{"a":1}');
    expect(loadLog()).toEqual([]);
    localStorage.setItem('droid-assist.log', 'not json');
    expect(loadLog()).toEqual([]);
  });
});

describe('cards', () => {
  beforeEach(() => localStorage.clear());

  const card: SavedCard = {
    id: 'card_1', name: 'Close ad and play', description: '2 steps', savedAt: 123,
    steps: [
      { id: 's1', name: 'Click 1', action: 'click', x: 0.4, y: 0.6, status: 'done', correctedX: 0.41 },
      { id: 's2', name: 'Type "hi"', action: 'type', x: 0.5, y: 0.5, text: 'hi', status: 'failed' },
    ],
  };

  it('round-trips cards with steps reset to pending', async () => {
    saveCards([card]);
    const [loaded] = await loadCards();
    expect(loaded).toMatchObject({ id: 'card_1', name: 'Close ad and play', description: '2 steps', savedAt: 123 });
    expect(loaded.steps.map((s) => [s.id, s.action, s.status, s.text])).toEqual([['s1', 'click', 'pending', undefined], ['s2', 'type', 'pending', 'hi']]);
  });

  it('keeps a step\'s named target so a reloaded step is still grounded', async () => {
    saveCards([{ ...card, steps: [{ id: 'm', name: 'Move to Files icon', action: 'move', target: 'Files icon', x: 0.4, y: 0.9, status: 'done' }] }]);
    const [loaded] = await loadCards();
    expect(loaded.steps[0]).toMatchObject({ action: 'move', target: 'Files icon' });
  });

  it('stores a step screenshot without its pixel buffer', () => {
    const refFrame = { id: 7, time: 1, url: 'data:image/jpeg;base64,AAAA', data: { width: 320 } as unknown as ImageData, srcW: 960, srcH: 540, source: 'demo' as const };
    saveCards([{ ...card, steps: [{ ...card.steps[0], refFrame }] }]);
    const stored = JSON.parse(localStorage.getItem('droid-assist.cards')!);
    expect(stored[0].steps[0].refFrame).toEqual({ id: 7, time: 1, url: 'data:image/jpeg;base64,AAAA', srcW: 960, srcH: 540, source: 'demo' });
  });

  it('drops invalid cards and steps and tolerates corrupt data', async () => {
    localStorage.setItem('droid-assist.cards', JSON.stringify([{ id: 'x', name: 'no steps' }, null, { ...card, steps: [card.steps[0], { id: 'bad', action: 'fly' }] }]));
    const loaded = await loadCards();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].steps.map((s) => s.id)).toEqual(['s1']);
    localStorage.setItem('droid-assist.cards', '{"a":1}');
    expect(await loadCards()).toEqual([]);
    localStorage.setItem('droid-assist.cards', '[');
    expect(await loadCards()).toEqual([]);
  });

  it('keeps running when localStorage throws', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    try {
      expect(() => saveCards([card])).not.toThrow();
      expect(() => saveLog([entry(1)])).not.toThrow();
      expect(() => saveSettings(DEFAULTS)).not.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(await loadCards()).toEqual([]);
  });
});

describe('cards: drift-corrected coordinates', () => {
  beforeEach(() => localStorage.clear());

  it('keeps a saved flow step\'s corrected coordinates so the next replay starts there', async () => {
    saveCards([{ id: 'f', name: 'Play video', description: '', savedAt: 5, steps: [{ id: 'a', name: 'Play', action: 'click', x: 0.52, y: 0.33, correctedX: 0.52, correctedY: 0.33, status: 'done' }] }]);
    const [loaded] = await loadCards();
    expect(loaded.steps[0]).toMatchObject({ x: 0.52, y: 0.33, correctedX: 0.52, correctedY: 0.33, status: 'pending' });
  });
});

describe('learned patterns', () => {
  beforeEach(() => localStorage.clear());
  const pat = (n: number, kind: LearnedPattern['kind'] = 'avoid'): LearnedPattern => ({ id: `p${n}`, kind, pattern: `pattern ${n}`, context: 'notepad', time: n });

  it('round-trips patterns under their own key', () => {
    savePatterns([pat(1), pat(2, 'add')]);
    expect(localStorage.getItem('droid-assist.patterns')).not.toBeNull();
    expect(loadPatterns()).toEqual([pat(1), pat(2, 'add')]);
  });

  it('starts empty and tolerates corrupt or invalid data', () => {
    expect(loadPatterns()).toEqual([]);
    localStorage.setItem('droid-assist.patterns', '{oops');
    expect(loadPatterns()).toEqual([]);
    localStorage.setItem('droid-assist.patterns', JSON.stringify([pat(3), { ...pat(4), kind: 'maybe' }, { ...pat(5), pattern: '  ' }, null, { id: 'x' }]));
    expect(loadPatterns()).toEqual([pat(3)]);
  });

  it('keeps at most PATTERN_LIMIT entries', () => {
    savePatterns(Array.from({ length: PATTERN_LIMIT + 5 }, (_, i) => pat(i)));
    expect(loadPatterns()).toHaveLength(PATTERN_LIMIT);
  });
});

describe('habits', () => {
  beforeEach(() => localStorage.clear());
  const habit = (overrides: Partial<Habit> = {}): Habit => ({
    id: 'h1', target: 'Save button', context: 'Notepad', attempts: 3, successes: 2, lastUsed: 1000,
    lessons: [{ kind: 'avoid', text: 'double click', time: 1 }], pinned: false,
    anchor: { x: 0.5, y: 0.4, patch: [1, 2, 3, 4], size: 2, time: 1 },
    ...overrides,
  });

  it('round-trips a valid habit with anchor and lessons under its own key', () => {
    saveHabits([habit()], 1000);
    expect(localStorage.getItem('droid-assist.habits')).not.toBeNull();
    expect(loadHabits(1000)).toEqual([habit()]);
  });

  it('returns [] for corrupt JSON', () => {
    localStorage.setItem('droid-assist.habits', '{bad');
    expect(loadHabits()).toEqual([]);
  });

  it('drops invalid entries, keeping only the valid habit', () => {
    localStorage.setItem('droid-assist.habits', JSON.stringify([habit(), { id: 1 }, null]));
    expect(loadHabits(1000)).toEqual([habit()]);
  });

  it('saveHabits prunes a stale unpinned habit but keeps a stale pinned one', () => {
    const now = 1_000_000_000;
    const stale = habit({ id: 'stale', lastUsed: now - HABIT_STALE_MS - 1, pinned: false, anchor: undefined });
    const stalePinned = habit({ id: 'stalePinned', lastUsed: now - HABIT_STALE_MS - 1, pinned: true, anchor: undefined });
    saveHabits([stale, stalePinned], now);
    expect(loadHabits(now)).toEqual([stalePinned]);
  });

  it('leaves existing LearnedPattern data untouched when no habit key exists', () => {
    const pat = (n: number): LearnedPattern => ({ id: `p${n}`, kind: 'avoid', pattern: `pattern ${n}`, context: 'notepad', time: n });
    savePatterns([pat(1)]);
    expect(loadPatterns()).toEqual([pat(1)]);
    expect(loadHabits()).toEqual([]);
  });
});

describe('familiar elements', () => {
  beforeEach(() => localStorage.clear());
  const fam = (n: number, patch?: string): FamiliarElement => ({ id: `el${n}`, name: `Element ${n}`, x: 0.1, y: 0.2, lastSeen: n, ...(patch ? { patch } : {}) });

  it('round-trips under their own key, next to the patterns', () => {
    savePatterns([{ id: 'p1', kind: 'add', pattern: 'p', context: '', time: 1 }]);
    saveFamiliar([fam(1, 'data:image/jpeg;base64,QQ'), fam(2)]);
    expect(localStorage.getItem('droid-assist.familiar')).not.toBeNull();
    expect(loadFamiliar()).toEqual([fam(1, 'data:image/jpeg;base64,QQ'), fam(2)]);
    expect(loadPatterns()).toHaveLength(1);
  });

  it('drops corrupt and invalid entries', () => {
    localStorage.setItem('droid-assist.familiar', '{oops');
    expect(loadFamiliar()).toEqual([]);
    localStorage.setItem('droid-assist.familiar', JSON.stringify([fam(3), { ...fam(4), x: 2 }, { ...fam(5), name: ' ' }, { ...fam(6), patch: 'javascript:x' }, null]));
    expect(loadFamiliar()).toEqual([fam(3)]);
  });

  it('keeps at most FAMILIAR_LIMIT entries', () => {
    saveFamiliar(Array.from({ length: FAMILIAR_LIMIT + 5 }, (_, i) => fam(i)));
    expect(loadFamiliar()).toHaveLength(FAMILIAR_LIMIT);
  });

  it('retries without patches when storage is full, leaving the patterns intact', () => {
    savePatterns([{ id: 'p1', kind: 'add', pattern: 'p', context: '', time: 1 }]);
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (v.includes('data:image')) throw new Error('QuotaExceededError');
      real.call(this, k, v);
    });
    saveFamiliar([fam(1, 'data:image/jpeg;base64,QQ')]);
    spy.mockRestore();
    expect(loadFamiliar()).toEqual([fam(1)]);
    expect(loadPatterns()).toHaveLength(1);
  });
});
