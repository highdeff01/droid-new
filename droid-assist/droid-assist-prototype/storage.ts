import type { AssistSettings, FamiliarElement, Habit, HabitAnchor, HabitLesson, LearnedPattern, LogEntry, MonitorMode, SavedCard, StepAction, WorkflowStep } from './types.js';
import { STEP_ACTIONS } from './types.js';
import { decodeFrame, isStoredFrame, toStoredFrame, type StoredFrame } from './frame-codec.js';
import { sanitizeBudget } from './safety.js';
import { pruneHabits } from './habits.js';
import { FAMILIAR_LIMIT } from './elements.js';
import { sanitizeStages } from './loop-control.js';

/** Most recent log entries kept, in memory and in storage. */
export const LOG_LIMIT = 200;

const KEYS = { settings: 'droid-assist.settings', cards: 'droid-assist.cards', log: 'droid-assist.log', patterns: 'droid-assist.patterns', habits: 'droid-assist.habits', familiar: 'droid-assist.familiar' } as const;

/** Most learned patterns kept. */
export const PATTERN_LIMIT = 100;
const PATTERN_KINDS: ReadonlyArray<LearnedPattern['kind']> = ['avoid', 'add'];

const ACTIONS: readonly StepAction[] = STEP_ACTIONS;
const MODES: readonly MonitorMode[] = ['app', 'background', 'advanced'];
const TONES: ReadonlyArray<LogEntry['tone']> = ['info', 'ok', 'warn', 'error'];

/** Valid range of each numeric setting (matches the Settings sliders). */
const RANGES: Record<'gallerySize' | 'checkpoints' | 'captureMs' | 'maxIterations', [number, number]> = {
  gallerySize: [4, 30],
  checkpoints: [1, 20],
  captureMs: [250, 2000],
  maxIterations: [1, 20],
};

/** A step as persisted: its screenshot without the pixel buffer. */
type StoredStep = Omit<WorkflowStep, 'refFrame'> & { refFrame?: StoredFrame };
type StoredCard = Omit<SavedCard, 'steps'> & { steps: StoredStep[] };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Parsed JSON at `key`, or undefined when missing, unreadable or corrupt. */
function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Writes `value` as JSON; false when storage is unavailable or full. */
function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Stored settings merged field by field over `defaults`; invalid fields keep their default. */
export function loadSettings(defaults: AssistSettings): AssistSettings {
  const stored = readJson(KEYS.settings);
  if (!isObject(stored)) return defaults;
  const out: AssistSettings = { ...defaults };
  for (const [key, [min, max]] of Object.entries(RANGES) as Array<[keyof typeof RANGES, [number, number]]>) {
    const v = stored[key];
    if (isNum(v) && v >= min && v <= max) out[key] = v;
  }
  for (const key of ['autoAct', 'aiHelp', 'showTrail', 'autoContinue', 'showGrid'] as const) {
    if (typeof stored[key] === 'boolean') out[key] = stored[key] as boolean;
  }
  if (typeof stored.bridgeUrl === 'string') out.bridgeUrl = stored.bridgeUrl;
  for (const key of ['abortHotkey', 'aiUrl', 'aiModel'] as const) {
    const v = stored[key];
    if (typeof v === 'string' && v.trim()) out[key] = v;
  }
  if (typeof stored.monitorMode === 'string' && MODES.includes(stored.monitorMode as MonitorMode)) out.monitorMode = stored.monitorMode as MonitorMode;
  if (isNum(stored.actionBudget)) out.actionBudget = sanitizeBudget(stored.actionBudget);
  out.stages = sanitizeStages(stored.stages ?? defaults.stages);
  return out;
}

/** Persists the settings. */
export function saveSettings(settings: AssistSettings) {
  writeJson(KEYS.settings, settings);
}

function isLogEntry(v: unknown): v is LogEntry {
  return isObject(v) && typeof v.id === 'string' && isNum(v.time) && typeof v.source === 'string'
    && typeof v.message === 'string' && TONES.includes(v.tone as LogEntry['tone']);
}

/** The stored action log (newest first, at most LOG_LIMIT); invalid entries are dropped. */
export function loadLog(): LogEntry[] {
  const stored = readJson(KEYS.log);
  return Array.isArray(stored) ? stored.filter(isLogEntry).slice(0, LOG_LIMIT) : [];
}

/** Persists the newest LOG_LIMIT log entries. */
export function saveLog(log: LogEntry[]) {
  writeJson(KEYS.log, log.slice(0, LOG_LIMIT));
}

/** A valid stored step normalised to a pending one, or null. */
function parseStep(v: unknown): StoredStep | null {
  if (!isObject(v) || typeof v.id !== 'string' || typeof v.name !== 'string' || !ACTIONS.includes(v.action as StepAction) || !isNum(v.x) || !isNum(v.y)) return null;
  return {
    id: v.id,
    name: v.name,
    action: v.action as StepAction,
    x: v.x,
    y: v.y,
    status: 'pending',
    ...(typeof v.text === 'string' ? { text: v.text } : {}),
    ...(isNum(v.correctedX) && isNum(v.correctedY) ? { correctedX: v.correctedX, correctedY: v.correctedY } : {}),
    ...(typeof v.target === 'string' && v.target ? { target: v.target } : {}),
    ...(isNum(v.endX) && isNum(v.endY) ? { endX: v.endX, endY: v.endY } : {}),
    ...(typeof v.endTarget === 'string' && v.endTarget ? { endTarget: v.endTarget } : {}),
    ...(isStoredFrame(v.refFrame) ? { refFrame: v.refFrame } : {}),
  };
}

/** A valid stored card with its valid steps, or null. */
function parseCard(v: unknown): StoredCard | null {
  if (!isObject(v) || typeof v.id !== 'string' || typeof v.name !== 'string' || !Array.isArray(v.steps)) return null;
  const steps = v.steps.map(parseStep).filter((s): s is StoredStep => s !== null);
  return { id: v.id, name: v.name, description: typeof v.description === 'string' ? v.description : '', savedAt: isNum(v.savedAt) ? v.savedAt : 0, steps };
}

/** Rebuilds a step's screenshot; a screenshot that fails to decode is dropped. */
async function restoreStep({ refFrame, ...step }: StoredStep): Promise<WorkflowStep> {
  const frame = refFrame ? await decodeFrame(refFrame) : null;
  return frame ? { ...step, refFrame: frame } : step;
}

/** The stored workflow cards with their step screenshots decoded; invalid cards are dropped. */
export async function loadCards(): Promise<SavedCard[]> {
  const stored = readJson(KEYS.cards);
  if (!Array.isArray(stored)) return [];
  const cards = stored.map(parseCard).filter((c): c is StoredCard => c !== null);
  return Promise.all(cards.map(async (c) => ({ ...c, steps: await Promise.all(c.steps.map(restoreStep)) })));
}

/** Persists the cards; when they do not fit, retries without step screenshots. */
export function saveCards(cards: SavedCard[]) {
  const toStored = (keepFrames: boolean): StoredCard[] => cards.map((c) => ({
    ...c,
    steps: c.steps.map(({ refFrame, ...s }) => (keepFrames && refFrame ? { ...s, refFrame: toStoredFrame(refFrame) } : s)),
  }));
  if (!writeJson(KEYS.cards, toStored(true))) writeJson(KEYS.cards, toStored(false));
}

function isPattern(v: unknown): v is LearnedPattern {
  return isObject(v) && typeof v.id === 'string' && PATTERN_KINDS.includes(v.kind as LearnedPattern['kind'])
    && typeof v.pattern === 'string' && !!v.pattern.trim() && typeof v.context === 'string' && isNum(v.time);
}

/** The stored learned patterns (newest first, at most PATTERN_LIMIT); invalid entries are dropped. */
export function loadPatterns(): LearnedPattern[] {
  const stored = readJson(KEYS.patterns);
  return Array.isArray(stored) ? stored.filter(isPattern).slice(0, PATTERN_LIMIT) : [];
}

/** Persists the newest PATTERN_LIMIT learned patterns. */
export function savePatterns(patterns: LearnedPattern[]) {
  writeJson(KEYS.patterns, patterns.slice(0, PATTERN_LIMIT));
}

function isLesson(v: unknown): v is HabitLesson {
  return isObject(v) && PATTERN_KINDS.includes(v.kind as LearnedPattern['kind']) && typeof v.text === 'string' && !!v.text.trim() && isNum(v.time);
}

function isAnchor(v: unknown): v is HabitAnchor {
  return isObject(v) && isNum(v.x) && isNum(v.y) && isNum(v.size) && isNum(v.time)
    && Array.isArray(v.patch) && v.patch.length === v.size * v.size && v.patch.every(isNum);
}

/** A valid stored habit (invalid lessons and anchor dropped), or null. */
function parseHabit(v: unknown): Habit | null {
  if (!isObject(v) || typeof v.id !== 'string' || typeof v.target !== 'string' || !v.target.trim() || typeof v.context !== 'string'
    || !isNum(v.attempts) || !isNum(v.successes) || v.successes < 0 || v.successes > v.attempts || !isNum(v.lastUsed)) return null;
  return {
    id: v.id,
    target: v.target,
    context: v.context,
    attempts: v.attempts,
    successes: v.successes,
    lastUsed: v.lastUsed,
    lessons: Array.isArray(v.lessons) ? v.lessons.filter(isLesson) : [],
    pinned: v.pinned === true,
    ...(isAnchor(v.anchor) ? { anchor: v.anchor } : {}),
  };
}

/** The stored habits, pruned of stale and low-value ones; invalid entries are dropped. */
export function loadHabits(now = Date.now()): Habit[] {
  const stored = readJson(KEYS.habits);
  return Array.isArray(stored) ? pruneHabits(stored.map(parseHabit).filter((h): h is Habit => h !== null), now) : [];
}

/** Persists the habits after pruning stale and low-value ones. */
export function saveHabits(habits: Habit[], now = Date.now()) {
  writeJson(KEYS.habits, pruneHabits(habits, now));
}

function isFamiliar(v: unknown): v is FamiliarElement {
  return isObject(v) && typeof v.id === 'string' && typeof v.name === 'string' && !!v.name.trim()
    && isNum(v.x) && isNum(v.y) && v.x >= 0 && v.x <= 1 && v.y >= 0 && v.y <= 1 && isNum(v.lastSeen)
    && (v.patch === undefined || (typeof v.patch === 'string' && v.patch.startsWith('data:image/')));
}

/** The stored familiar elements (newest first, at most FAMILIAR_LIMIT); invalid entries are dropped. */
export function loadFamiliar(): FamiliarElement[] {
  const stored = readJson(KEYS.familiar);
  return Array.isArray(stored) ? stored.filter(isFamiliar).slice(0, FAMILIAR_LIMIT) : [];
}

/** Persists the familiar elements; when they do not fit, retries without their screenshot patches. */
export function saveFamiliar(elements: FamiliarElement[]) {
  const kept = elements.slice(0, FAMILIAR_LIMIT);
  if (!writeJson(KEYS.familiar, kept)) writeJson(KEYS.familiar, kept.map(({ patch: _patch, ...e }) => e));
}
