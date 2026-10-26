import type { AssistSettings, FamiliarElement, LearnedPattern, LogEntry, MonitorMode, SavedCard, StepAction, WorkflowStep } from './types.js';
import { STEP_ACTIONS } from './types.js';
import { decodeFrame, isStoredFrame, toStoredFrame, type StoredFrame } from './frame-codec.js';
import { sanitizeBudget } from './safety.js';
import { FAMILIAR_LIMIT } from './elements.js';
import { MAP_LIMIT, type MappedElement } from './element-map.js';

/** Most recent log entries kept, in memory and in storage. */
export const LOG_LIMIT = 200;

const KEYS = { settings: 'droid-assist.settings', cards: 'droid-assist.cards', log: 'droid-assist.log', patterns: 'droid-assist.patterns', familiar: 'droid-assist.familiar', elementMap: 'droid-assist.element-map' } as const;

/** Most learned patterns kept. */
export const PATTERN_LIMIT = 100;
const PATTERN_KINDS: ReadonlyArray<LearnedPattern['kind']> = ['avoid', 'add'];

const ACTIONS: readonly StepAction[] = STEP_ACTIONS;
const MODES: readonly MonitorMode[] = ['app', 'background', 'advanced'];
const TONES: ReadonlyArray<LogEntry['tone']> = ['info', 'ok', 'warn', 'error'];

/** Valid range of each numeric setting (matches the Settings sliders). */
const RANGES: Record<'gallerySize' | 'checkpoints' | 'captureMs', [number, number]> = {
  gallerySize: [4, 30],
  checkpoints: [1, 20],
  captureMs: [250, 2000],
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
  for (const key of ['autoAct', 'aiHelp', 'showTrail', 'showGrid'] as const) {
    if (typeof stored[key] === 'boolean') out[key] = stored[key] as boolean;
  }
  if (typeof stored.bridgeUrl === 'string') out.bridgeUrl = stored.bridgeUrl;
  for (const key of ['abortHotkey', 'aiUrl', 'aiModel'] as const) {
    const v = stored[key];
    if (typeof v === 'string' && v.trim()) out[key] = v;
  }
  if (typeof stored.monitorMode === 'string' && MODES.includes(stored.monitorMode as MonitorMode)) out.monitorMode = stored.monitorMode as MonitorMode;
  if (isNum(stored.actionBudget)) out.actionBudget = sanitizeBudget(stored.actionBudget);
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

type StoredMapped = Omit<MappedElement, 'frame'> & { frame?: StoredFrame };

const isUnit = (v: unknown) => isNum(v) && v >= 0 && v <= 1;

/** A valid stored mapped element (box inside the screen), or null. */
function parseMapped(v: unknown): StoredMapped | null {
  if (!isObject(v) || typeof v.id !== 'string' || typeof v.name !== 'string' || !v.name.trim() || !isObject(v.box)) return null;
  const { x, y, w, h } = v.box;
  if (!isUnit(x) || !isUnit(y) || !isUnit(w) || !isUnit(h) || (x as number) + (w as number) > 1.0001 || (y as number) + (h as number) > 1.0001) return null;
  return {
    id: v.id,
    name: v.name,
    box: { x: x as number, y: y as number, w: w as number, h: h as number },
    mappedAt: isNum(v.mappedAt) ? v.mappedAt : 0,
    ...(isStoredFrame(v.frame) ? { frame: v.frame } : {}),
  };
}

/** The stored element map (newest first, at most MAP_LIMIT) with frames decoded; invalid entries are dropped. */
export async function loadElementMap(): Promise<MappedElement[]> {
  const stored = readJson(KEYS.elementMap);
  if (!Array.isArray(stored)) return [];
  const items = stored.map(parseMapped).filter((m): m is StoredMapped => m !== null).slice(0, MAP_LIMIT);
  return Promise.all(items.map(async ({ frame, ...m }) => {
    const decoded = frame ? await decodeFrame(frame) : null;
    return decoded ? { ...m, frame: decoded } : m;
  }));
}

/** Persists the element map; when it does not fit, retries without the frames. */
export function saveElementMap(list: MappedElement[]) {
  const kept = list.slice(0, MAP_LIMIT);
  const withFrames: StoredMapped[] = kept.map(({ frame, ...m }) => (frame ? { ...m, frame: toStoredFrame(frame) } : m));
  if (!writeJson(KEYS.elementMap, withFrames)) writeJson(KEYS.elementMap, kept.map(({ frame: _frame, ...m }) => m));
}

/** Persists the familiar elements; when they do not fit, retries without their screenshot patches. */
export function saveFamiliar(elements: FamiliarElement[]) {
  const kept = elements.slice(0, FAMILIAR_LIMIT);
  if (!writeJson(KEYS.familiar, kept)) writeJson(KEYS.familiar, kept.map(({ patch: _patch, ...e }) => e));
}
