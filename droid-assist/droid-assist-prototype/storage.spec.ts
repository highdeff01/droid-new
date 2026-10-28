import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistSettings, FamiliarElement, Habit, LearnedPattern, LogEntry, SavedCard, WorkflowStep } from './types.js';
import { LOG_LIMIT, PATTERN_LIMIT, SYSTEM_FOLDER_LIMIT, loadAccessPaths, loadApprovalQueue, loadCards, loadDossiers, loadElementMap, loadFamiliar, loadGoals, loadHabits, loadLog, loadNotifications, loadOperationMemory, loadOperations, loadPatterns, loadPersonas, loadProjects, loadRunSummaries, loadSettings, loadWatcher, saveAccessPaths, saveApprovalQueue, saveCards, saveDossiers, saveElementMap, saveFamiliar, saveGoals, saveHabits, saveLog, saveNotifications, saveOperationMemory, saveOperations, savePatterns, savePersonas, saveProjects, saveRunSummaries, saveSettings, saveWatcher } from './storage.js';
import { PROJECT_LIMIT, createProject, type PlannedStep, type Project } from './project.js';
import { EMPTY_APPROVALS, decide, enqueue } from './approval-queue.js';
import { DEFAULT_AUTO_ACT, NOTIFICATION_LIMIT, type AssistNotification } from './notifications.js';
import type { Persona } from './persona.js';
import { FAMILIAR_LIMIT } from './elements.js';
import { HABIT_STALE_MS } from './habits.js';
import { DEFAULT_STAGES } from './loop-control.js';
import type { WatchNote, WatchProposal, WatchTest } from './watcher.js';
import { DEFAULT_SETTINGS } from './use-assist.js';
import { DEFAULT_GRID_OPACITY } from './grid-overlay.js';
import { RUN_SUMMARY_LIMIT, type RunSummary } from './run-stats.js';
import { EMPTY_MEMORY, addFailure, addNote, newFailure } from './operation-memory.js';
import { MASTER_PROMPT_MAX } from './ai.js';
import { ACCESS_PATH_LIMIT, type AccessProfile } from './access-paths.js';
import type { PositionDossier } from './position-dossier.js';
import { GOAL_LIMIT, createGoal, trace, type TraceContext } from './goal-tracer.js';
import type { SavedOperation } from './saved-operations.js';

const DEFAULTS: AssistSettings = { ...DEFAULT_SETTINGS, aiUrl: 'https://ai.example/api/chat', autoContinue: false };
const entry = (n: number): LogEntry => ({ id: `log_${n}`, time: n, source: 'Test', message: `message ${n}`, tone: 'info' });

describe('settings', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a rearranged panel layout and validates it on load', () => {
    const panelLayout = { side: [...DEFAULTS.panelLayout.side].reverse(), bottom: [...DEFAULTS.panelLayout.bottom] };
    saveSettings({ ...DEFAULTS, panelLayout });
    expect(JSON.parse(localStorage.getItem('droid-assist.settings')!).panelLayout).toEqual(panelLayout);
    expect(loadSettings(DEFAULTS).panelLayout).toEqual(panelLayout);
    localStorage.setItem('droid-assist.settings', '{"panelLayout":42}');
    expect(loadSettings(DEFAULTS).panelLayout).toEqual(DEFAULTS.panelLayout);
    localStorage.setItem('droid-assist.settings', '{"panelLayout":{"side":["log","bogus","log"]}}');
    const loaded = loadSettings(DEFAULTS).panelLayout;
    expect(loaded.side[0]).toBe('log');
    expect([...loaded.side, ...loaded.bottom].sort()).toEqual([...DEFAULTS.panelLayout.side, ...DEFAULTS.panelLayout.bottom].sort());
  });

  it('round-trips saved settings', () => {
    const custom = { ...DEFAULTS, bridgeUrl: 'http://127.0.0.1:9000', bridgeToken: 'tok', captureMs: 1250, autoAct: true };
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

  it('auto-continue defaults on for fresh settings and settings saved without it; an explicit off is kept', () => {
    expect(loadSettings(DEFAULT_SETTINGS).autoContinue).toBe(true);
    localStorage.setItem('droid-assist.settings', '{"bridgeUrl":"x"}');
    expect(loadSettings(DEFAULT_SETTINGS).autoContinue).toBe(true);
    localStorage.setItem('droid-assist.settings', '{"autoContinue":false}');
    expect(loadSettings(DEFAULT_SETTINGS).autoContinue).toBe(false);
  });

  it('model thinking defaults off; a saved on round-trips and non-boolean values fall back', () => {
    expect(DEFAULT_SETTINGS.aiThink).toBe(false);
    expect(loadSettings(DEFAULT_SETTINGS).aiThink).toBe(false);
    saveSettings({ ...DEFAULT_SETTINGS, aiThink: true });
    expect(loadSettings(DEFAULT_SETTINGS).aiThink).toBe(true);
    for (const raw of ['{"aiThink":"true"}', '{"aiThink":1}', '{}']) {
      localStorage.setItem('droid-assist.settings', raw);
      expect(loadSettings(DEFAULT_SETTINGS).aiThink).toBe(false);
    }
  });

  it('grid labels default off with a faint grid; the grid settings round-trip and invalid values fall back', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ gridLabels: false, gridOpacity: DEFAULT_GRID_OPACITY });
    expect(DEFAULT_GRID_OPACITY).toBeLessThan(0.28);
    saveSettings({ ...DEFAULT_SETTINGS, gridLabels: true, gridOpacity: 0.3 });
    expect(loadSettings(DEFAULT_SETTINGS)).toMatchObject({ gridLabels: true, gridOpacity: 0.3 });
    localStorage.setItem('droid-assist.settings', '{"gridLabels":"yes","gridOpacity":1}');
    expect(loadSettings(DEFAULT_SETTINGS)).toMatchObject({ gridLabels: false, gridOpacity: DEFAULT_GRID_OPACITY });
  });

  it('returns the defaults for corrupt or non-object JSON', () => {
    for (const raw of ['{', '[1,2]', 'null', '42']) {
      localStorage.setItem('droid-assist.settings', raw);
      expect(loadSettings(DEFAULTS)).toEqual(DEFAULTS);
    }
  });

  it('keeps a stored watchMs within 2000..30000 and falls back to the default otherwise', () => {
    localStorage.setItem('droid-assist.settings', '{"watchMs":8000}');
    expect(loadSettings(DEFAULTS).watchMs).toBe(8000);
    for (const bad of [0, -5, 100000, '8000']) {
      localStorage.setItem('droid-assist.settings', JSON.stringify({ watchMs: bad }));
      expect(loadSettings(DEFAULTS).watchMs).toBe(DEFAULTS.watchMs);
    }
  });

  it('keeps a stored goalStall within 1..10 and falls back to the default (2) otherwise', () => {
    expect(DEFAULT_SETTINGS.goalStall).toBe(2);
    for (const ok of [1, 10]) {
      localStorage.setItem('droid-assist.settings', JSON.stringify({ goalStall: ok }));
      expect(loadSettings(DEFAULTS).goalStall).toBe(ok);
    }
    for (const bad of [0, 11, '3']) {
      localStorage.setItem('droid-assist.settings', JSON.stringify({ goalStall: bad }));
      expect(loadSettings(DEFAULTS).goalStall).toBe(DEFAULTS.goalStall);
    }
  });

  it('keeps in-range drift, grid-opacity and AI concurrency settings and falls back on out-of-range ones', () => {
    const inRange = { driftStable: 0.2, driftMatched: 0.4, driftRadius: 32, gridOpacity: 0.3, aiMaxInFlight: 8 };
    localStorage.setItem('droid-assist.settings', JSON.stringify(inRange));
    expect(loadSettings(DEFAULTS)).toMatchObject(inRange);
    localStorage.setItem('droid-assist.settings', JSON.stringify({ driftStable: 0.5, driftMatched: 0.01, driftRadius: 100, gridOpacity: 1, aiMaxInFlight: 9 }));
    expect(loadSettings(DEFAULTS)).toEqual(DEFAULTS);
  });

  it('keeps an in-range AI timeout and falls back to the default on an out-of-range or non-numeric one', () => {
    for (const ok of [10_000, 45_000, 300_000]) {
      localStorage.setItem('droid-assist.settings', JSON.stringify({ aiTimeoutMs: ok }));
      expect(loadSettings(DEFAULTS).aiTimeoutMs).toBe(ok);
    }
    for (const bad of [0, 9_999, 300_001, '60000', null]) {
      localStorage.setItem('droid-assist.settings', JSON.stringify({ aiTimeoutMs: bad }));
      expect(loadSettings(DEFAULTS).aiTimeoutMs).toBe(DEFAULTS.aiTimeoutMs);
    }
  });

  it('persists the Master Prompt Override and overlap mode, keeping the defaults on invalid values', () => {
    expect(DEFAULTS.masterPrompt).toBe('');
    expect(DEFAULTS.aiOverlap).toBe(false);
    saveSettings({ ...DEFAULTS, masterPrompt: 'Prefer keyboard shortcuts', aiOverlap: true });
    expect(loadSettings(DEFAULTS)).toMatchObject({ masterPrompt: 'Prefer keyboard shortcuts', aiOverlap: true });
    localStorage.setItem('droid-assist.settings', JSON.stringify({ masterPrompt: 42, aiOverlap: 'yes' }));
    expect(loadSettings(DEFAULTS)).toMatchObject({ masterPrompt: '', aiOverlap: false });
    localStorage.setItem('droid-assist.settings', JSON.stringify({ masterPrompt: 'x'.repeat(MASTER_PROMPT_MAX + 1) }));
    expect(loadSettings(DEFAULTS).masterPrompt).toBe('');
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

  it('keeps a recorded step\'s measured delay so a saved flow replays with human timing', async () => {
    saveCards([{ ...card, steps: [{ id: 'k', name: 'Press ctrl+s', action: 'key', text: 'ctrl+s', x: 0.5, y: 0.5, delayMs: 840, status: 'done' }, { id: 'bad', name: 'x', action: 'click', x: 0.1, y: 0.1, delayMs: -5, status: 'done' }] }]);
    const [loaded] = await loadCards();
    expect(loaded.steps[0]).toMatchObject({ action: 'key', text: 'ctrl+s', delayMs: 840 });
    expect(loaded.steps[1].delayMs).toBeUndefined();
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

  it('round-trips learned coordinate fields (timesSeen, frameId, numeric anchor)', () => {
    const learned: FamiliarElement = { ...fam(7), timesSeen: 3, frameId: 9, anchor: [1, 2, 3] };
    saveFamiliar([learned]);
    expect(loadFamiliar()).toEqual([learned]);
  });

  it('drops entries with a non-numeric timesSeen or a non-numeric anchor', () => {
    localStorage.setItem('droid-assist.familiar', JSON.stringify([{ ...fam(8), timesSeen: 'x' }, { ...fam(9), anchor: ['a'] }]));
    expect(loadFamiliar()).toEqual([]);
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

describe('operation memory', () => {
  beforeEach(() => localStorage.clear());
  const failure = newFailure({ operation: 'Send invoice', actor: 'Replay', what: 'Step "Send" did not complete', steps: ['"Send" (click)'], targets: ['Send'], shots: ['data:image/jpeg;base64,QQ'] }, 5);

  it('round-trips failures and notes and drops invalid entries', () => {
    const memory = addNote(addFailure(EMPTY_MEMORY, failure), 'Send invoice', 'Check the recipient', 6);
    saveOperationMemory(memory);
    expect(loadOperationMemory()).toEqual(memory);
    localStorage.setItem('droid-assist.memory', JSON.stringify({ failures: [null, { ...failure, steps: 'x' }, failure], notes: [{ id: 'n', time: 1, operation: 'op', text: ' ' }] }));
    expect(loadOperationMemory()).toEqual({ failures: [failure], notes: [] });
    localStorage.setItem('droid-assist.memory', 'nope');
    expect(loadOperationMemory()).toEqual(EMPTY_MEMORY);
  });

  it('retries without the failure screenshots when storage is full', () => {
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (v.includes('data:image')) throw new Error('QuotaExceededError');
      real.call(this, k, v);
    });
    saveOperationMemory(addFailure(EMPTY_MEMORY, failure));
    spy.mockRestore();
    expect(loadOperationMemory().failures).toEqual([{ ...failure, shots: [] }]);
  });
});

describe('element map', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips mapped elements under its own key and drops invalid ones', async () => {
    saveElementMap([{ id: 'm1', name: 'OK', box: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, mappedAt: 5 }]);
    expect(localStorage.getItem('droid-assist.element-map')).not.toBeNull();
    expect(await loadElementMap()).toEqual([{ id: 'm1', name: 'OK', box: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, mappedAt: 5 }]);
    localStorage.setItem('droid-assist.element-map', JSON.stringify([null, { id: 'a', name: ' ', box: { x: 0, y: 0, w: 0.1, h: 0.1 } }, { id: 'b', name: 'B', box: { x: 0.9, y: 0, w: 0.5, h: 0.1 } }, { id: 'c', name: 'C', box: { x: 0, y: 0, w: 0.1, h: 0.1 } }]));
    expect((await loadElementMap()).map((m) => m.id)).toEqual(['c']);
    localStorage.setItem('droid-assist.element-map', 'nope');
    expect(await loadElementMap()).toEqual([]);
  });
});

describe('loadWatcher', () => {
  beforeEach(() => localStorage.clear());

  const note = (n: number): WatchNote => ({ id: `n${n}`, time: n, kind: 'element', text: `note ${n}` });
  const proposal = (n: number): WatchProposal => ({ id: `w${n}`, time: n, kind: 'pattern', text: `proposal ${n}`, status: 'pending' });
  const test = (n: number): WatchTest => ({ id: `t${n}`, time: n, proposalId: 'w1', tried: 'click', happened: 'nothing', verdict: 'passed', dryRun: true });

  it('round-trips notes, proposals and tests', () => {
    const state = { notes: [note(1), note(2)], proposals: [proposal(1)], tests: [test(1)] };
    saveWatcher(state);
    expect(loadWatcher()).toEqual(state);
  });

  it('drops invalid entries', () => {
    localStorage.setItem('droid-assist.watcher', JSON.stringify({
      notes: [note(1), { ...note(2), kind: 'bogus' }, { ...note(3), text: '' }, null],
      proposals: [proposal(1), { ...proposal(2), status: 'bogus' }, null],
      tests: [test(1), { ...test(2), verdict: 'maybe' }, null],
    }));
    expect(loadWatcher()).toEqual({ notes: [note(1)], proposals: [proposal(1)], tests: [test(1)] });
  });

  it('gives empty lists for corrupt JSON', () => {
    localStorage.setItem('droid-assist.watcher', '{oops');
    expect(loadWatcher()).toEqual({ notes: [], proposals: [], tests: [] });
  });
});

describe('run summaries', () => {
  beforeEach(() => localStorage.clear());

  const summary = (n: number): RunSummary => ({ id: `run_${n}`, time: n, session: 's', goal: `goal ${n}`, attempted: 3, succeeded: 2, durationMs: 1500, outcome: 'failed' });

  it('round-trips summaries, newest first, keeping the flow id', () => {
    const runs = [{ ...summary(2), flowId: 'card_1' }, summary(1)];
    saveRunSummaries(runs);
    expect(loadRunSummaries()).toEqual(runs);
  });

  it('keeps only the newest RUN_SUMMARY_LIMIT summaries', () => {
    saveRunSummaries(Array.from({ length: RUN_SUMMARY_LIMIT + 10 }, (_, i) => summary(RUN_SUMMARY_LIMIT + 10 - i)));
    const loaded = loadRunSummaries();
    expect(loaded).toHaveLength(RUN_SUMMARY_LIMIT);
    expect(loaded[0]).toEqual(summary(RUN_SUMMARY_LIMIT + 10));
  });

  it('prunes the oldest summaries until the write fits in storage', () => {
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === 'droid-assist.runs' && v.length > 600) throw new DOMException('full', 'QuotaExceededError');
      real.call(this, k, v);
    });
    saveRunSummaries(Array.from({ length: 8 }, (_, i) => summary(8 - i)));
    spy.mockRestore();
    const loaded = loadRunSummaries();
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.length).toBeLessThan(8);
    expect(loaded[0]).toEqual(summary(8));
  });

  it('drops invalid summaries and tolerates corrupt data', () => {
    localStorage.setItem('droid-assist.runs', JSON.stringify([null, summary(1), { ...summary(2), outcome: 'great' }, { ...summary(3), attempted: '3' }]));
    expect(loadRunSummaries()).toEqual([summary(1)]);
    localStorage.setItem('droid-assist.runs', '{nope');
    expect(loadRunSummaries()).toEqual([]);
  });
});

describe('projects', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips saved projects', () => {
    const projects = [createProject('Script', 'Write a script', 2), createProject('Deck', 'Build a slide deck', 1)];
    saveProjects(projects);
    expect(loadProjects()).toEqual(projects);
  });

  it('drops invalid entries and corrupt JSON returns []', () => {
    const valid = createProject('Deck', 'Build a slide deck', 1);
    localStorage.setItem('droid-assist.projects', JSON.stringify([valid, null, { id: 'bad' }, { ...valid, state: 'bogus' }]));
    expect(loadProjects()).toEqual([valid]);
    localStorage.setItem('droid-assist.projects', '{nope');
    expect(loadProjects()).toEqual([]);
  });

  it('saveProjects prunes beyond PROJECT_LIMIT keeping unfinished first', () => {
    const finished: Project = { ...createProject('Done', 'goal', 1), state: 'complete', completion: { done: true, reason: 'ok', time: 1 }, updatedAt: 1000 };
    const unfinished = Array.from({ length: PROJECT_LIMIT + 5 }, (_, i) => createProject(`P${i}`, 'goal', i + 2));
    saveProjects([finished, ...unfinished]);
    const loaded = loadProjects();
    expect(loaded).toHaveLength(PROJECT_LIMIT);
    expect(loaded.every((p) => p.state !== 'complete')).toBe(true);
  });
});

describe('approvals', () => {
  beforeEach(() => localStorage.clear());
  const step = (n: number): PlannedStep => ({ id: `s${n}`, name: `Step ${n}`, action: 'click', x: 0.1, y: 0.2 });

  it('round-trips queue and learned methods', () => {
    const { state: queued } = enqueue(EMPTY_APPROVALS, 'proj_1', [step(1)], 5);
    const decided = decide(queued, queued.queue[0].id, { kind: 'approve' }, 'notepad', 10);
    expect(decided).not.toBeNull();
    saveApprovalQueue(decided!.state);
    expect(loadApprovalQueue()).toEqual(decided!.state);
  });

  it('returns EMPTY_APPROVALS when missing or corrupt', () => {
    expect(loadApprovalQueue()).toEqual(EMPTY_APPROVALS);
    localStorage.setItem('droid-assist.approval-queue', '{nope');
    expect(loadApprovalQueue()).toEqual(EMPTY_APPROVALS);
    localStorage.setItem('droid-assist.approval-queue', '[1,2]');
    expect(loadApprovalQueue()).toEqual(EMPTY_APPROVALS);
  });

  it('drops invalid requests', () => {
    const { state: queued } = enqueue(EMPTY_APPROVALS, 'proj_1', [step(1), step(2)], 5);
    const [valid, invalid] = queued.queue;
    localStorage.setItem('droid-assist.approval-queue', JSON.stringify({ queue: [valid, null, { ...invalid, step: { id: 'bad' } }], learned: [] }));
    expect(loadApprovalQueue()).toEqual({ queue: [valid], learned: [] });
  });
});

describe('loadAccessPaths', () => {
  beforeEach(() => localStorage.clear());

  const profile = (n: number): AccessProfile => ({
    id: `path_${n}`, target: `Target ${n}`, context: 'ctx',
    versions: [{ version: 1, hops: [{ label: 'Games', action: 'click', x: 0.2, y: 0.3 }], uses: 2, successes: 2, savedAt: n, lastUsed: n }],
  });

  it('round-trips saved profiles', () => {
    savePatterns([]);
    saveAccessPaths([profile(1), profile(2)]);
    expect(localStorage.getItem('droid-assist.access-paths')).not.toBeNull();
    expect(loadAccessPaths()).toEqual([profile(1), profile(2)]);
  });

  it('drops invalid entries and tolerates corrupt data', () => {
    localStorage.setItem('droid-assist.access-paths', JSON.stringify([profile(1), null, { ...profile(2), versions: [] }, { ...profile(3), target: ' ' }]));
    expect(loadAccessPaths()).toEqual([profile(1)]);
    localStorage.setItem('droid-assist.access-paths', '{bad');
    expect(loadAccessPaths()).toEqual([]);
  });

  it('keeps at most ACCESS_PATH_LIMIT entries', () => {
    saveAccessPaths(Array.from({ length: ACCESS_PATH_LIMIT + 5 }, (_, i) => profile(i)));
    expect(loadAccessPaths()).toHaveLength(ACCESS_PATH_LIMIT);
  });
});

describe('loadDossiers', () => {
  beforeEach(() => localStorage.clear());

  const dossier = (n: number, lastSeen = n): PositionDossier => ({
    id: `pos_${n}`, name: `Element ${n}`, visits: [{ x: 0.1, y: 0.2, since: n }], spots: [], tests: [],
    timesSeen: 1, lastSeen, moves: { user: 0, ai: 0 },
  });

  it('round-trips saveDossiers/loadDossiers keeping a valid dossier', () => {
    saveDossiers([dossier(1)]);
    expect(localStorage.getItem('droid-assist.dossiers')).not.toBeNull();
    expect(loadDossiers()).toEqual([dossier(1)]);
  });

  it('drops an invalid entry (missing visits, out-of-range x)', () => {
    localStorage.setItem('droid-assist.dossiers', JSON.stringify([
      dossier(1),
      { ...dossier(2), visits: [] },
      { ...dossier(3), visits: [{ x: 2, y: 0.2, since: 3 }] },
      null,
    ]));
    expect(loadDossiers()).toEqual([dossier(1)]);
  });

  it('keeps only the 100 dossiers with the newest lastSeen when saving 120', () => {
    saveDossiers(Array.from({ length: 120 }, (_, i) => dossier(i, i)));
    const loaded = loadDossiers();
    expect(loaded).toHaveLength(100);
    expect(loaded[0]).toEqual(dossier(119, 119));
    expect(loaded.map((d) => d.lastSeen)).not.toContain(19);
  });
});

describe('goals', () => {
  beforeEach(() => localStorage.clear());

  const ctx: TraceContext = { now: 1000, stallLimit: 2 };
  const twoStepGoal = (n: number) => {
    let g = createGoal({ goal: `Finish task ${n}`, source: 'user', steps: [{ id: 's1', name: 'Step 1' }, { id: 's2', name: 'Step 2' }] }, n);
    g = trace(g, { kind: 'step', stepId: 's1', name: 'Step 1', ok: true, executed: true, detail: '' }, ctx).record;
    g = trace(g, { kind: 'deviation', cause: 'popup', text: 'ad popup appeared' }, ctx).record;
    g = trace(g, { kind: 'run', runId: `run_${n}`, outcome: 'success', flowId: 'card_1' }, ctx).record;
    return g;
  };

  it('round-trips goals under their own key, newest first', () => {
    const goals = [twoStepGoal(2), twoStepGoal(1)];
    saveGoals(goals);
    expect(localStorage.getItem('droid-assist.goals')).not.toBeNull();
    expect(loadGoals()).toEqual(goals);
  });

  it('keeps only the newest GOAL_LIMIT goals', () => {
    saveGoals(Array.from({ length: GOAL_LIMIT + 5 }, (_, i) => createGoal({ goal: `g${i}`, source: 'user', steps: [] }, i)));
    expect(loadGoals()).toHaveLength(GOAL_LIMIT);
  });

  it('prunes the oldest goal records until the write fits in storage', () => {
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === 'droid-assist.goals' && v.length > 1200) throw new DOMException('full', 'QuotaExceededError');
      real.call(this, k, v);
    });
    const goals = Array.from({ length: 8 }, (_, i) => createGoal({ goal: `g${8 - i}`, source: 'user', steps: [] }, 8 - i));
    saveGoals(goals);
    spy.mockRestore();
    const loaded = loadGoals();
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.length).toBeLessThan(8);
    expect(loaded[0]).toEqual(goals[0]);
  });

  it('drops invalid records and tolerates corrupt data', () => {
    const valid = createGoal({ goal: 'Base', source: 'user', steps: [{ id: 's1', name: 'Step 1' }] }, 500);
    localStorage.setItem('droid-assist.goals', JSON.stringify([
      valid,
      null,
      { ...valid, status: 'great' },
      { ...valid, source: 'bogus' },
      { ...valid, steps: {} },
      { ...valid, progress: 150 },
    ]));
    expect(loadGoals()).toEqual([valid]);
    localStorage.setItem('droid-assist.goals', '{nope');
    expect(loadGoals()).toEqual([]);
  });
});

describe('settings: system & relax', () => {
  beforeEach(() => localStorage.clear());

  it('DEFAULT_SETTINGS has the system & relax defaults', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ relaxMode: false, breakMinutes: 45, systemRefreshSec: 30, notifyAutoAct: DEFAULT_AUTO_ACT, systemFolders: [] });
  });

  it('round-trips relaxMode, breakMinutes, systemRefreshSec, notifyAutoAct and systemFolders', () => {
    const custom = { ...DEFAULTS, relaxMode: true, breakMinutes: 20, systemRefreshSec: 60, notifyAutoAct: { ...DEFAULT_AUTO_ACT, suggestion: true }, systemFolders: ['/home/u/docs'] };
    saveSettings(custom);
    expect(loadSettings(DEFAULTS)).toEqual(custom);
  });

  it('keeps breakMinutes only within 5..120', () => {
    for (const bad of [2, 500, 'x']) {
      localStorage.setItem('droid-assist.settings', JSON.stringify({ breakMinutes: bad }));
      expect(loadSettings(DEFAULTS).breakMinutes).toBe(DEFAULTS.breakMinutes);
    }
  });

  it('keeps systemRefreshSec only within 5..600', () => {
    for (const bad of [1, 1000]) {
      localStorage.setItem('droid-assist.settings', JSON.stringify({ systemRefreshSec: bad }));
      expect(loadSettings(DEFAULTS).systemRefreshSec).toBe(DEFAULTS.systemRefreshSec);
    }
  });

  it('falls back to the default relaxMode on a non-boolean value', () => {
    localStorage.setItem('droid-assist.settings', '{"relaxMode":"yes"}');
    expect(loadSettings(DEFAULTS).relaxMode).toBe(DEFAULTS.relaxMode);
  });

  it('sanitizes a stored notifyAutoAct map, keeping every category and dropping unknown keys', () => {
    localStorage.setItem('droid-assist.settings', JSON.stringify({ notifyAutoAct: { suggestion: 'true', ai: true, bogus: true } }));
    const loaded = loadSettings(DEFAULTS).notifyAutoAct;
    expect(loaded).toEqual({ ...DEFAULT_AUTO_ACT, ai: true });
    expect(loaded).not.toHaveProperty('bogus');
  });

  it('defaults notifyAutoAct when missing from stored settings', () => {
    localStorage.setItem('droid-assist.settings', '{"bridgeUrl":"x"}');
    expect(loadSettings(DEFAULTS).notifyAutoAct).toEqual(DEFAULT_AUTO_ACT);
  });

  it('filters non-strings, blanks and duplicates from systemFolders and caps at SYSTEM_FOLDER_LIMIT', () => {
    const many = Array.from({ length: SYSTEM_FOLDER_LIMIT + 5 }, (_, i) => `/f${i}`);
    localStorage.setItem('droid-assist.settings', JSON.stringify({ systemFolders: [...many, '/f0', '  ', 42, null] }));
    const loaded = loadSettings(DEFAULTS).systemFolders;
    expect(loaded).toHaveLength(SYSTEM_FOLDER_LIMIT);
    expect(loaded).toEqual(many.slice(0, SYSTEM_FOLDER_LIMIT));
  });

  it('keeps the default systemFolders when the stored value is not an array', () => {
    localStorage.setItem('droid-assist.settings', '{"systemFolders":"nope"}');
    expect(loadSettings(DEFAULTS).systemFolders).toEqual(DEFAULTS.systemFolders);
  });
});

describe('notifications', () => {
  beforeEach(() => localStorage.clear());
  const notif = (overrides: Partial<AssistNotification> = {}): AssistNotification => ({
    id: 'n1', time: 1000, source: 'AI', category: 'ai', severity: 'warning', title: 'AI status changed', read: false,
    ...overrides,
  });

  it('round-trips a valid notification under its own key', () => {
    saveNotifications([notif()]);
    expect(localStorage.getItem('droid-assist.notifications')).not.toBeNull();
    expect(loadNotifications()).toEqual([notif()]);
  });

  it('drops invalid entries', () => {
    localStorage.setItem('droid-assist.notifications', JSON.stringify([notif(), { ...notif(), id: 'n2', category: 'bogus' }, null]));
    expect(loadNotifications()).toEqual([notif()]);
  });

  it('keeps only the newest NOTIFICATION_LIMIT entries', () => {
    const list = Array.from({ length: NOTIFICATION_LIMIT + 10 }, (_, i) => notif({ id: `n${i}`, time: i }));
    saveNotifications(list);
    expect(loadNotifications()).toHaveLength(NOTIFICATION_LIMIT);
  });

  it('returns [] for corrupt JSON', () => {
    localStorage.setItem('droid-assist.notifications', '{bad');
    expect(loadNotifications()).toEqual([]);
  });
});

describe('loadSettingsExecutionMode', () => {
  beforeEach(() => localStorage.clear());

  it('persists a valid stored executionMode', () => {
    localStorage.setItem('droid-assist.settings', JSON.stringify({ executionMode: 'watching' }));
    expect(loadSettings(DEFAULTS).executionMode).toBe('watching');
  });

  it('falls back to thoughtful for an unknown or non-string executionMode', () => {
    for (const bad of ['warp', 7]) {
      localStorage.setItem('droid-assist.settings', JSON.stringify({ executionMode: bad }));
      expect(loadSettings(DEFAULTS).executionMode).toBe('thoughtful');
    }
  });

  it('keeps a valid stored autoApply as given', () => {
    const autoApply = { enabled: true, minConfidence: 0.6, maxShift: 0.1, maxPerRun: 2 };
    localStorage.setItem('droid-assist.settings', JSON.stringify({ autoApply }));
    expect(loadSettings(DEFAULTS).autoApply).toEqual(autoApply);
  });

  it('sanitizes an invalid stored autoApply field by field to the defaults', () => {
    localStorage.setItem('droid-assist.settings', JSON.stringify({ autoApply: { enabled: true, minConfidence: 3, maxShift: -1, maxPerRun: 0 } }));
    expect(loadSettings(DEFAULTS).autoApply).toEqual({ enabled: true, minConfidence: 0.8, maxShift: 0.05, maxPerRun: 5 });
  });

  it('leaves monitorMode unaffected by executionMode', () => {
    localStorage.setItem('droid-assist.settings', JSON.stringify({ executionMode: 'watching', monitorMode: 'background' }));
    const loaded = loadSettings(DEFAULTS);
    expect(loaded.executionMode).toBe('watching');
    expect(loaded.monitorMode).toBe('background');
  });
});

describe('loadPersonas', () => {
  beforeEach(() => localStorage.clear());

  const persona = (n: number): Persona => ({
    id: `p${n}`, name: `Persona ${n}`, character: `Character ${n}`, createdAt: n,
    entries: [{ kind: 'did', text: `did ${n}`, time: n }],
  });

  it('round-trips saved personas', () => {
    savePersonas([persona(1), persona(2)]);
    expect(loadPersonas()).toEqual([persona(1), persona(2)]);
  });

  it('stores personas under their own key', () => {
    savePersonas([persona(1)]);
    expect(localStorage.getItem('droid-assist.personas')).not.toBeNull();
  });

  it('returns [] for corrupt JSON', () => {
    localStorage.setItem('droid-assist.personas', '{oops');
    expect(loadPersonas()).toEqual([]);
  });

  it('drops invalid personas and invalid entries of a valid persona', () => {
    localStorage.setItem('droid-assist.personas', JSON.stringify([
      { ...persona(1), name: '   ' },
      { ...persona(2), createdAt: undefined },
      { ...persona(3), entries: [{ kind: 'bogus', text: 'x', time: 1 }, { kind: 'did', text: '   ', time: 2 }, { kind: 'learned', text: 'ok', time: 3 }] },
      null,
    ]));
    expect(loadPersonas()).toEqual([{ ...persona(3), entries: [{ kind: 'learned', text: 'ok', time: 3 }] }]);
  });
});

describe('loadSettings: playbackWindowSec', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to 30 s', () => {
    expect(DEFAULTS.playbackWindowSec).toBe(30);
    expect(loadSettings(DEFAULTS).playbackWindowSec).toBe(30);
  });

  it('keeps stored windows inside 30..600 s, including both ends', () => {
    for (const ok of [30, 300, 600]) {
      localStorage.setItem('droid-assist.settings', JSON.stringify({ playbackWindowSec: ok }));
      expect(loadSettings(DEFAULTS).playbackWindowSec).toBe(ok);
    }
  });

  it('falls back to the default for 29, 601 and non-numbers', () => {
    for (const bad of [29, 601, '120']) {
      localStorage.setItem('droid-assist.settings', JSON.stringify({ playbackWindowSec: bad }));
      expect(loadSettings(DEFAULTS).playbackWindowSec).toBe(30);
    }
  });
});

describe('loadSettings: operationRetries', () => {
  beforeEach(() => localStorage.clear());

  it('keeps a stored operationRetries of 5', () => {
    localStorage.setItem('droid-assist.settings', '{"operationRetries":5}');
    expect(loadSettings(DEFAULTS).operationRetries).toBe(5);
  });

  it('falls back to the default (2) for 11 and -1', () => {
    for (const bad of [11, -1]) {
      localStorage.setItem('droid-assist.settings', JSON.stringify({ operationRetries: bad }));
      expect(loadSettings(DEFAULTS).operationRetries).toBe(DEFAULTS.operationRetries);
    }
  });
});

describe('loadOperations / saveOperations', () => {
  beforeEach(() => localStorage.clear());

  const operation: SavedOperation = {
    id: 'op_1',
    name: 'Open YouTube',
    goal: 'open youtube in chrome',
    steps: [{ id: 's1', name: 'Click Chrome', action: 'click', x: 0.5, y: 0.5, status: 'done' } as WorkflowStep],
    screenshots: [],
    source: 'ai',
    savedAt: 100,
    runs: 2,
    successes: 1,
  };

  it('round-trips name/goal/steps(pending)/runs/successes/source', async () => {
    saveOperations([operation]);
    const [loaded] = await loadOperations();
    expect(loaded).toMatchObject({ name: 'Open YouTube', goal: 'open youtube in chrome', runs: 2, successes: 1, source: 'ai' });
    expect(loaded.steps.map((s) => s.status)).toEqual(['pending']);
    expect(loaded.screenshots).toEqual([]);
  });

  it('drops invalid entries', async () => {
    localStorage.setItem('droid-assist.operations', JSON.stringify([operation, { id: 'bad' }, null]));
    const loaded = await loadOperations();
    expect(loaded).toHaveLength(1);
  });

  it('leaves other stored keys untouched', () => {
    saveCards([]);
    const triggers = ['droid-assist.triggers', JSON.stringify([{ foo: 'bar' }])] as const;
    localStorage.setItem(triggers[0], triggers[1]);
    saveOperations([operation]);
    expect(localStorage.getItem('droid-assist.cards')).toBe('[]');
    expect(localStorage.getItem('droid-assist.triggers')).toBe(triggers[1]);
  });

  it('gives [] screenshots when none are saved', async () => {
    saveOperations([operation]);
    const [loaded] = await loadOperations();
    expect(loaded.screenshots).toEqual([]);
  });
});
