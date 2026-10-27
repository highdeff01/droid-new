import type { AssistSettings, FamiliarElement, Habit, HabitAnchor, HabitLesson, LearnedPattern, LogEntry, MonitorMode, SavedCard, StepAction, StepStatus, WorkflowStep } from './types.js';
import { STEP_ACTIONS } from './types.js';
import { decodeFrame, isStoredFrame, toStoredFrame, type StoredFrame } from './frame-codec.js';
import { sanitizeBudget } from './safety.js';
import { FAMILIAR_LIMIT } from './elements.js';
import { MAP_LIMIT, type ElementKind, type MappedElement, type MoveEvent, type PerformFn, type PositionRecord } from './element-map-studio.js';
import { TRAIN_MODES, type TrainMode } from './element-training.js';
import { PERFORM_KINDS, checkPerform } from './element-perform.js';
import { pruneHabits } from './habits.js';
import { OUTBOX_LIMIT, isErrorReport, type ErrorReport } from './error-forwarding.js';
import { EMPTY_WATCHER, NOTE_KINDS, NOTE_LIMIT, PROPOSAL_KINDS, PROPOSAL_LIMIT, PROPOSAL_STATUSES, TEST_LIMIT } from './watcher.js';
import type { NoteKind, ProposalKind, ProposalStatus, WatchNote, WatchProposal, WatchTest, WatcherState } from './watcher.js';
import { sanitizeStages } from './loop-control.js';
import { AI_TIMEOUT_MS_MAX, AI_TIMEOUT_MS_MIN, AI_VIEWS, type AiView } from './ai.js';
import { STEP_RETRIES_MAX, STEP_RETRIES_MIN } from './retry-ladder.js';
import { AI_MAX_IN_FLIGHT_MAX, AI_MAX_IN_FLIGHT_MIN } from './ai-queue.js';
import { GRID_OPACITY_RANGE } from './grid-overlay.js';
import { TRIGGER_LIMIT, isTrigger, type Trigger } from './triggers.js';
import { CREW_SIZE_MAX, CREW_SIZE_MIN } from './crew.js';
import { RUN_OUTCOMES, RUN_SUMMARY_LIMIT, type RunOutcome, type RunSummary } from './run-stats.js';
import { EMPTY_MEMORY, FAILURE_LIMIT, OPERATION_NOTE_LIMIT, isFailureRecord, isOperationNote, type OperationMemory } from './operation-memory.js';
import { ACCESS_PATH_LIMIT, isAccessProfile, type AccessProfile } from './access-paths.js';
import { APPROVAL_LIMIT, isApprovalItem, sanitizePolicy, type ApprovalItem } from './approvals.js';
import { PORTFOLIO_LIMIT, isPortfolioEntry, type PortfolioEntry } from './portfolio.js';
import { PROFILE_LIMIT, isProfileEvent, type ProfileEvent } from './user-profile.js';
import { SECTION_LIMIT, isKnowledgeSection, type KnowledgeSection } from './knowledge-sections.js';
import { VARIATION_LIMIT, VARIATION_STATUSES, type Variation, type VariationStatus } from './variations.js';
import { PACK_TEST_LIMIT, type GoalSource, type PackKind, type PackTestResult, type WorkflowPack } from './packs.js';
import type { SubagentStatus } from './subagents.js';
import { PROFILE_LIMIT, type RouteHop, type RouteProfile } from './route-plot.js';
import { FIX_ACTIONS, FIX_METHOD_LIMIT, type FixMethod } from './fix-script.js';
import { DOSSIER_LIMIT, pruneDossiers, type PositionDossier } from './position-dossier.js';
import { SIDE_TEST_MODES, type SideTestMode } from './side-test.js';
import { SECTION_EVENT_LIMIT, SECTION_LIMIT, type ScreenSection, type SectionEvent } from './sections.js';
import { WAKE_MS_MAX, WAKE_MS_MIN } from './wake.js';
import { EMPTY_INITIATIVE, INITIATIVE_CATEGORIES, INITIATIVE_LOG_LIMIT, INITIATIVE_PROPOSAL_LIMIT, INITIATIVE_STATUSES, SCAN_SEC_MAX, SCAN_SEC_MIN, SELF_TEST_MODES, STRESS_CYCLES_MAX, STRESS_CYCLES_MIN, STRESS_LIMIT } from './initiative.js';
import type { AutoApplyMap, InitiativeCategory, InitiativeEntry, InitiativeProposal, InitiativeState, InitiativeStatus, SelfTestMode, StressReport } from './initiative.js';

/** Valid range of the Screen watcher interval (matches its Settings slider). */
export const WATCH_MS_MIN = 2000;
export const WATCH_MS_MAX = 30000;

/** Most recent log entries kept, in memory and in storage. */
export const LOG_LIMIT = 200;

const KEYS = { settings: 'droid-assist.settings', cards: 'droid-assist.cards', log: 'droid-assist.log', patterns: 'droid-assist.patterns', outbox: 'droid-assist.outbox', habits: 'droid-assist.habits', familiar: 'droid-assist.familiar', watcher: 'droid-assist.watcher', elementMap: 'droid-assist.element-map', triggers: 'droid-assist.triggers', runs: 'droid-assist.runs', portfolios: 'droid-assist.portfolios', profile: 'droid-assist.user-profile', sections: 'droid-assist.knowledge-sections', variations: 'droid-assist.variations', accessPaths: 'droid-assist.access-paths', approvals: 'droid-assist.approvals' } as const;
const STEP_STATUSES: readonly StepStatus[] = ['pending', 'running', 'done', 'drift', 'failed'];
const KEYS = { settings: 'droid-assist.settings', cards: 'droid-assist.cards', log: 'droid-assist.log', patterns: 'droid-assist.patterns', outbox: 'droid-assist.outbox', habits: 'droid-assist.habits', familiar: 'droid-assist.familiar', watcher: 'droid-assist.watcher', elementMap: 'droid-assist.element-map', triggers: 'droid-assist.triggers', runs: 'droid-assist.runs', packs: 'droid-assist.packs' } as const;
const KEYS = { settings: 'droid-assist.settings', cards: 'droid-assist.cards', log: 'droid-assist.log', patterns: 'droid-assist.patterns', outbox: 'droid-assist.outbox', habits: 'droid-assist.habits', familiar: 'droid-assist.familiar', watcher: 'droid-assist.watcher', elementMap: 'droid-assist.element-map', triggers: 'droid-assist.triggers', runs: 'droid-assist.runs', routes: 'droid-assist.routes', fixMethods: 'droid-assist.fix-methods' } as const;
const KEYS = { settings: 'droid-assist.settings', cards: 'droid-assist.cards', log: 'droid-assist.log', patterns: 'droid-assist.patterns', outbox: 'droid-assist.outbox', habits: 'droid-assist.habits', familiar: 'droid-assist.familiar', watcher: 'droid-assist.watcher', elementMap: 'droid-assist.element-map', triggers: 'droid-assist.triggers', runs: 'droid-assist.runs', dossiers: 'droid-assist.dossiers' } as const;
const KEYS = { settings: 'droid-assist.settings', cards: 'droid-assist.cards', log: 'droid-assist.log', patterns: 'droid-assist.patterns', outbox: 'droid-assist.outbox', habits: 'droid-assist.habits', familiar: 'droid-assist.familiar', watcher: 'droid-assist.watcher', elementMap: 'droid-assist.element-map', triggers: 'droid-assist.triggers', runs: 'droid-assist.runs', sections: 'droid-assist.sections' } as const;
const KEYS = { settings: 'droid-assist.settings', cards: 'droid-assist.cards', log: 'droid-assist.log', patterns: 'droid-assist.patterns', outbox: 'droid-assist.outbox', habits: 'droid-assist.habits', familiar: 'droid-assist.familiar', watcher: 'droid-assist.watcher', elementMap: 'droid-assist.element-map', triggers: 'droid-assist.triggers', runs: 'droid-assist.runs', initiative: 'droid-assist.initiative' } as const;

/** Most learned patterns kept. */
export const PATTERN_LIMIT = 100;
const PATTERN_KINDS: ReadonlyArray<LearnedPattern['kind']> = ['avoid', 'add'];

const ACTIONS: readonly StepAction[] = STEP_ACTIONS;
/** Every monitor mode. */
export const MODES: readonly MonitorMode[] = ['app', 'background', 'advanced'];
const TONES: ReadonlyArray<LogEntry['tone']> = ['info', 'ok', 'warn', 'error'];

/** Valid range of each numeric setting (matches the Settings sliders). */
export const RANGES: Record<'gallerySize' | 'checkpoints' | 'captureMs' | 'watchMs' | 'changeCells' | 'maxIterations' | 'stepRetries' | 'driftStable' | 'driftMatched' | 'driftRadius' | 'gridOpacity' | 'aiMaxInFlight' | 'aiTimeoutMs', [number, number]> = {
const RANGES: Record<'gallerySize' | 'checkpoints' | 'captureMs' | 'watchMs' | 'changeCells' | 'maxIterations' | 'stepRetries' | 'driftStable' | 'driftMatched' | 'driftRadius' | 'gridOpacity' | 'aiMaxInFlight' | 'aiTimeoutMs' | 'crewSize', [number, number]> = {
  crewSize: [CREW_SIZE_MIN, CREW_SIZE_MAX],
const RANGES: Record<'gallerySize' | 'checkpoints' | 'captureMs' | 'watchMs' | 'wakeMs' | 'changeCells' | 'maxIterations' | 'stepRetries' | 'driftStable' | 'driftMatched' | 'driftRadius' | 'gridOpacity' | 'aiMaxInFlight' | 'aiTimeoutMs', [number, number]> = {
const RANGES: Record<'gallerySize' | 'checkpoints' | 'captureMs' | 'watchMs' | 'changeCells' | 'maxIterations' | 'stepRetries' | 'driftStable' | 'driftMatched' | 'driftRadius' | 'gridOpacity' | 'aiMaxInFlight' | 'aiTimeoutMs' | 'scanSec' | 'stressCycles', [number, number]> = {
  gallerySize: [4, 30],
  checkpoints: [1, 20],
  captureMs: [250, 2000],
  watchMs: [WATCH_MS_MIN, WATCH_MS_MAX],
  wakeMs: [WAKE_MS_MIN, WAKE_MS_MAX],
  changeCells: [2, 40],
  maxIterations: [1, 20],
  stepRetries: [STEP_RETRIES_MIN, STEP_RETRIES_MAX],
  driftStable: [0.01, 0.3],
  driftMatched: [0.02, 0.5],
  driftRadius: [4, 64],
  gridOpacity: GRID_OPACITY_RANGE,
  aiMaxInFlight: [AI_MAX_IN_FLIGHT_MIN, AI_MAX_IN_FLIGHT_MAX],
  aiTimeoutMs: [AI_TIMEOUT_MS_MIN, AI_TIMEOUT_MS_MAX],
  scanSec: [SCAN_SEC_MIN, SCAN_SEC_MAX],
  stressCycles: [STRESS_CYCLES_MIN, STRESS_CYCLES_MAX],
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
  for (const key of ['autoAct', 'aiHelp', 'showTrail', 'errorForwarding', 'autoContinue', 'showGrid', 'gridLabels', 'autoScan'] as const) {
  out.crewSize = Math.round(out.crewSize);
  for (const key of ['autoAct', 'aiHelp', 'showTrail', 'errorForwarding', 'autoContinue', 'showGrid', 'gridLabels'] as const) {
    if (typeof stored[key] === 'boolean') out[key] = stored[key] as boolean;
  }
  for (const key of ['bridgeUrl', 'bridgeToken', 'errorUrl', 'errorToken'] as const) {
    const v = stored[key];
    if (typeof v === 'string') out[key] = v;
  }
  for (const key of ['abortHotkey', 'aiUrl', 'aiModel'] as const) {
    const v = stored[key];
    if (typeof v === 'string' && v.trim()) out[key] = v;
  }
  if (typeof stored.aiView === 'string' && Object.hasOwn(AI_VIEWS, stored.aiView)) out.aiView = stored.aiView as AiView;
  if (typeof stored.trainMode === 'string' && TRAIN_MODES.includes(stored.trainMode as TrainMode)) out.trainMode = stored.trainMode as TrainMode;
  if (typeof stored.monitorMode === 'string' && MODES.includes(stored.monitorMode as MonitorMode)) out.monitorMode = stored.monitorMode as MonitorMode;
  if (stored.displayId === null || (typeof stored.displayId === 'string' && stored.displayId)) out.displayId = stored.displayId;
  if (isNum(stored.actionBudget)) out.actionBudget = sanitizeBudget(stored.actionBudget);
  out.stages = sanitizeStages(stored.stages ?? defaults.stages);
  out.operationPolicy = sanitizePolicy(stored.operationPolicy, defaults.operationPolicy);
  if (SIDE_TEST_MODES.includes(stored.sideTestMode as SideTestMode)) out.sideTestMode = stored.sideTestMode as SideTestMode;
  if (typeof stored.selfTestMode === 'string' && SELF_TEST_MODES.includes(stored.selfTestMode as SelfTestMode)) out.selfTestMode = stored.selfTestMode as SelfTestMode;
  out.autoApply = sanitizeAutoApply(stored.autoApply, defaults.autoApply);
  return out;
}

/** A stored auto-apply map over `defaults`: only boolean values of known categories are kept. */
function sanitizeAutoApply(raw: unknown, defaults: AutoApplyMap): AutoApplyMap {
  const out = { ...defaults };
  if (!isObject(raw)) return out;
  for (const c of INITIATIVE_CATEGORIES) if (typeof raw[c] === 'boolean') out[c] = raw[c] as boolean;
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
  // Screenshot evidence is too large for localStorage; JSON drops the undefined field.
  writeJson(KEYS.log, log.slice(0, LOG_LIMIT).map((l) => (l.shots ? { ...l, shots: undefined } : l)));
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
    ...(typeof v.mappedId === 'string' && v.mappedId ? { mappedId: v.mappedId } : {}),
    ...(isNum(v.delayMs) && v.delayMs >= 0 ? { delayMs: v.delayMs } : {}),
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

const PACK_KINDS: ReadonlyArray<PackKind> = ['recorded', 'combined'];
const GOAL_SOURCES: ReadonlyArray<GoalSource> = ['input', 'ai', 'user', null];
const TEST_STATUSES: ReadonlyArray<SubagentStatus> = ['pass', 'fail', 'aborted', 'skipped'];
type StoredPack = Omit<WorkflowPack, 'steps'> & { steps: StoredStep[] };

function isPackTest(v: unknown): v is PackTestResult {
  return isObject(v) && typeof v.id === 'string' && isNum(v.time) && TEST_STATUSES.includes(v.status as SubagentStatus) && typeof v.message === 'string' && typeof v.dry === 'boolean';
}

/** A valid stored pack with its valid steps and test results, or null. */
function parsePack(v: unknown): StoredPack | null {
  if (!isObject(v) || typeof v.id !== 'string' || typeof v.name !== 'string' || !Array.isArray(v.steps)) return null;
  const goal = typeof v.goal === 'string' ? v.goal : '';
  return {
    id: v.id,
    name: v.name,
    kind: PACK_KINDS.includes(v.kind as PackKind) ? (v.kind as PackKind) : 'recorded',
    goal,
    goalSource: goal && GOAL_SOURCES.includes(v.goalSource as GoalSource) ? (v.goalSource as GoalSource) : null,
    steps: v.steps.map(parseStep).filter((s): s is StoredStep => s !== null),
    tests: Array.isArray(v.tests) ? v.tests.filter(isPackTest).slice(0, PACK_TEST_LIMIT) : [],
    savedAt: isNum(v.savedAt) ? v.savedAt : 0,
  };
}

/** The stored workflow packs with their step screenshots decoded; invalid packs are dropped. */
export async function loadPacks(): Promise<WorkflowPack[]> {
  const stored = readJson(KEYS.packs);
  if (!Array.isArray(stored)) return [];
  const packs = stored.map(parsePack).filter((p): p is StoredPack => p !== null);
  return Promise.all(packs.map(async (p) => ({ ...p, steps: await Promise.all(p.steps.map(restoreStep)) })));
}

/** Persists the packs; when they do not fit, retries without step screenshots. */
export function savePacks(packs: WorkflowPack[]) {
  const toStored = (keepFrames: boolean): StoredPack[] => packs.map((p) => ({
    ...p,
    steps: p.steps.map(({ refFrame, shot: _shot, beforeFrame: _before, afterFrame: _after, ...s }) => (keepFrames && refFrame ? { ...s, refFrame: toStoredFrame(refFrame) } : s)),
  }));
  if (!writeJson(KEYS.packs, toStored(true))) writeJson(KEYS.packs, toStored(false));
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

/** The persisted error outbox (newest first, at most OUTBOX_LIMIT); invalid entries are dropped. */
export function loadOutbox(): ErrorReport[] {
  const stored = readJson(KEYS.outbox);
  return Array.isArray(stored) ? stored.filter(isErrorReport).slice(0, OUTBOX_LIMIT) : [];
}

/** Persists the newest OUTBOX_LIMIT reports; when they do not fit, retries without screenshots. */
export function saveOutbox(outbox: ErrorReport[]) {
  const kept = outbox.slice(0, OUTBOX_LIMIT);
  if (!writeJson(KEYS.outbox, kept)) writeJson(KEYS.outbox, kept.map((r) => ({ ...r, screenshot: null })));
}

/** Persists the newest PATTERN_LIMIT learned patterns. */
export function savePatterns(patterns: LearnedPattern[]) {
  writeJson(KEYS.patterns, patterns.slice(0, PATTERN_LIMIT));
}

function isFamiliar(v: unknown): v is FamiliarElement {
  return isObject(v) && typeof v.id === 'string' && typeof v.name === 'string' && !!v.name.trim()
    && isNum(v.x) && isNum(v.y) && v.x >= 0 && v.x <= 1 && v.y >= 0 && v.y <= 1 && isNum(v.lastSeen)
    && (v.patch === undefined || (typeof v.patch === 'string' && v.patch.startsWith('data:image/')))
    && (v.timesSeen === undefined || isNum(v.timesSeen)) && (v.frameId === undefined || isNum(v.frameId))
    && (v.anchor === undefined || (Array.isArray(v.anchor) && v.anchor.every(isNum)));
}

/** The stored familiar elements (newest first, at most FAMILIAR_LIMIT); invalid entries are dropped. */
export function loadFamiliar(): FamiliarElement[] {
  const stored = readJson(KEYS.familiar);
  return Array.isArray(stored) ? stored.filter(isFamiliar).slice(0, FAMILIAR_LIMIT) : [];
}

type StoredMapped = Omit<MappedElement, 'frame'> & { frame?: StoredFrame };

const isUnit = (v: unknown) => isNum(v) && v >= 0 && v <= 1;
const ELEMENT_KINDS: readonly ElementKind[] = ['button', 'icon', 'text', 'input', 'region'];
const MOVE_CAUSES: ReadonlyArray<MoveEvent['cause']> = ['user', 'ai', 'self'];

/** A box inside the screen, or null. */
function parseBox(v: unknown): MappedElement['box'] | null {
  if (!isObject(v)) return null;
  const { x, y, w, h } = v;
  if (!isUnit(x) || !isUnit(y) || !isUnit(w) || !isUnit(h) || (x as number) + (w as number) > 1.0001 || (y as number) + (h as number) > 1.0001) return null;
  return { x: x as number, y: y as number, w: w as number, h: h as number };
}

function parsePosition(v: unknown): PositionRecord | null {
  const box = isObject(v) ? parseBox(v.box) : null;
  if (!box || !isObject(v) || !isNum(v.count) || !isNum(v.firstSeen) || !isNum(v.lastSeen)) return null;
  return { box, count: v.count, firstSeen: v.firstSeen, lastSeen: v.lastSeen };
}

function parseMove(v: unknown): MoveEvent | null {
  if (!isObject(v) || !isNum(v.time) || !MOVE_CAUSES.includes(v.cause as MoveEvent['cause'])) return null;
  const from = parseBox(v.from);
  const to = parseBox(v.to);
  return from && to ? { time: v.time, cause: v.cause as MoveEvent['cause'], from, to } : null;
}

/** A complete stored perform function, or null. */
function parsePerform(v: unknown): PerformFn | null {
  if (!isObject(v) || !PERFORM_KINDS.includes(v.kind as PerformFn['kind']) || (v.source !== 'user' && v.source !== 'ai')) return null;
  const p: PerformFn = {
    kind: v.kind as PerformFn['kind'],
    source: v.source,
    ...(typeof v.text === 'string' ? { text: v.text } : {}),
    ...(isObject(v.to) && isUnit(v.to.x) && isUnit(v.to.y) ? { to: { x: v.to.x as number, y: v.to.y as number } } : {}),
    ...(typeof v.toElementId === 'string' && v.toElementId ? { toElementId: v.toElementId } : {}),
    ...(typeof v.reason === 'string' && v.reason ? { reason: v.reason } : {}),
  };
  return checkPerform(p).ok ? p : null;
}

const parsedList = <T>(v: unknown, parse: (x: unknown) => T | null): T[] => (Array.isArray(v) ? v.map(parse).filter((x): x is T => x !== null) : []);

/** The auto-scan and tracking fields of a stored mapped element; invalid ones are dropped. */
function parseTracking(v: Json): Partial<MappedElement> {
  const perform = parsePerform(v.perform);
  return {
    ...(v.origin === 'user' || v.origin === 'auto' ? { origin: v.origin } : {}),
    ...(ELEMENT_KINDS.includes(v.kind as ElementKind) ? { kind: v.kind as ElementKind } : {}),
    ...(isObject(v.appearance) && isNum(v.appearance.lum) && isNum(v.appearance.edges) ? { appearance: { lum: v.appearance.lum, edges: v.appearance.edges } } : {}),
    ...(isNum(v.timesSeen) ? { timesSeen: v.timesSeen } : {}),
    ...(isNum(v.lastSeen) ? { lastSeen: v.lastSeen } : {}),
    ...(Array.isArray(v.positions) ? { positions: parsedList(v.positions, parsePosition) } : {}),
    ...(Array.isArray(v.moves) ? { moves: parsedList(v.moves, parseMove) } : {}),
    ...(perform ? { perform } : {}),
  };
}

/** A valid stored mapped element (box inside the screen), or null. */
function parseMapped(v: unknown): StoredMapped | null {
  if (!isObject(v) || typeof v.id !== 'string' || typeof v.name !== 'string' || !v.name.trim()) return null;
  const box = parseBox(v.box);
  if (!box) return null;
  return {
    id: v.id,
    name: v.name,
    box,
    mappedAt: isNum(v.mappedAt) ? v.mappedAt : 0,
    ...parseTracking(v),
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

const isStr = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
const optNum = (v: unknown) => v === undefined || isNum(v);

function isNote(v: unknown): v is WatchNote {
  return isObject(v) && isStr(v.id) && isNum(v.time) && NOTE_KINDS.includes(v.kind as NoteKind) && isStr(v.text)
    && (v.source === undefined || typeof v.source === 'string') && (v.op === undefined || typeof v.op === 'string');
}

function isProposal(v: unknown): v is WatchProposal {
  return isObject(v) && isStr(v.id) && isNum(v.time) && PROPOSAL_KINDS.includes(v.kind as ProposalKind) && isStr(v.text)
    && PROPOSAL_STATUSES.includes(v.status as ProposalStatus) && (v.target === undefined || typeof v.target === 'string')
    && optNum(v.x) && optNum(v.y) && optNum(v.from) && optNum(v.to);
}

function isTest(v: unknown): v is WatchTest {
  return isObject(v) && isStr(v.id) && isNum(v.time) && typeof v.proposalId === 'string' && typeof v.tried === 'string'
    && typeof v.happened === 'string' && (v.verdict === 'passed' || v.verdict === 'failed') && typeof v.dryRun === 'boolean';
}

const listOf = <T>(v: unknown, guard: (x: unknown) => x is T, limit: number): T[] => (Array.isArray(v) ? v.filter(guard).slice(0, limit) : []);

/** The stored Screen watcher notes, proposals and test results; invalid entries are dropped. */
export function loadWatcher(): WatcherState {
  const stored = readJson(KEYS.watcher);
  if (!isObject(stored)) return EMPTY_WATCHER;
  return { notes: listOf(stored.notes, isNote, NOTE_LIMIT), proposals: listOf(stored.proposals, isProposal, PROPOSAL_LIMIT), tests: listOf(stored.tests, isTest, TEST_LIMIT) };
}

function isRunSummary(v: unknown): v is RunSummary {
  return isObject(v) && isStr(v.id) && isNum(v.time) && typeof v.session === 'string' && typeof v.goal === 'string'
    && isNum(v.attempted) && isNum(v.succeeded) && isNum(v.durationMs) && RUN_OUTCOMES.includes(v.outcome as RunOutcome)
    && (v.flowId === undefined || typeof v.flowId === 'string');
}

/** The stored run summaries (newest first, at most RUN_SUMMARY_LIMIT); invalid entries are dropped. */
export function loadRunSummaries(): RunSummary[] {
  return listOf(readJson(KEYS.runs), isRunSummary, RUN_SUMMARY_LIMIT);
}

/** Persists the newest RUN_SUMMARY_LIMIT summaries; while they do not fit, the oldest half is pruned. */
export function saveRunSummaries(summaries: RunSummary[]) {
  let kept = summaries.slice(0, RUN_SUMMARY_LIMIT);
  while (!writeJson(KEYS.runs, kept) && kept.length) kept = kept.slice(0, Math.floor(kept.length / 2));
}

const isPoint = (v: unknown) => isObject(v) && isUnit(v.x) && isUnit(v.y);
const isVisit = (v: unknown) => isPoint(v) && isNum((v as Json).since) && optNum((v as Json).until);
const isSpot = (v: unknown) => isPoint(v) && isNum((v as Json).attempts) && isNum((v as Json).successes);
const isPositionTest = (v: unknown) => isObject(v) && isPoint(v.planned) && isPoint(v.actual) && isNum(v.time);
const isMoves = (v: unknown) => isObject(v) && isNum(v.user) && isNum(v.ai);
const optPoint = (v: unknown) => v === undefined || isPoint(v);

function isDossier(v: unknown): v is PositionDossier {
  return isObject(v) && isStr(v.id) && isStr(v.name) && Array.isArray(v.visits) && v.visits.length > 0 && v.visits.every(isVisit)
    && Array.isArray(v.spots) && v.spots.every(isSpot) && Array.isArray(v.tests) && v.tests.every(isPositionTest)
    && isNum(v.timesSeen) && isNum(v.lastSeen) && isMoves(v.moves) && optPoint(v.move) && optPoint(v.preferred);
}

/** The stored position dossiers (at most DOSSIER_LIMIT); invalid entries are dropped. */
export const loadDossiers = (): PositionDossier[] => listOf(readJson(KEYS.dossiers), isDossier, DOSSIER_LIMIT);

/** Persists the newest-seen DOSSIER_LIMIT dossiers; while they do not fit, the least recently seen half is pruned. */
export function saveDossiers(dossiers: PositionDossier[]) {
  let kept = pruneDossiers(dossiers);
  while (!writeJson(KEYS.dossiers, kept) && kept.length) kept = kept.slice(0, Math.floor(kept.length / 2));
}

/** Persists the Screen watcher state, capped per list. */
export function saveWatcher(state: WatcherState) {
  writeJson(KEYS.watcher, { notes: state.notes.slice(0, NOTE_LIMIT), proposals: state.proposals.slice(0, PROPOSAL_LIMIT), tests: state.tests.slice(0, TEST_LIMIT) });
}

/** The stored triggers; invalid entries are dropped. */
export const loadTriggers = (): Trigger[] => listOf(readJson(KEYS.triggers), isTrigger, TRIGGER_LIMIT);

const HOP_VIAS: ReadonlyArray<RouteHop['via']> = ['start', 'opens', 'contains', 'adjacent'];

function isHop(v: unknown): v is RouteHop {
  return isObject(v) && isStr(v.name) && isUnit(v.x) && isUnit(v.y) && HOP_VIAS.includes(v.via as RouteHop['via']);
}

function isProfile(v: unknown): v is RouteProfile {
  return isObject(v) && isStr(v.id) && isStr(v.goal) && Array.isArray(v.hops) && v.hops.length > 0 && v.hops.every(isHop)
    && isNum(v.uses) && isNum(v.successes) && isNum(v.savedAt);
}

/** The stored access-path (route) profiles; invalid entries are dropped. */
export const loadRouteProfiles = (): RouteProfile[] => listOf(readJson(KEYS.routes), isProfile, PROFILE_LIMIT);

/** Persists the route profiles, capped at PROFILE_LIMIT. */
export function saveRouteProfiles(profiles: RouteProfile[]) {
  writeJson(KEYS.routes, profiles.slice(0, PROFILE_LIMIT));
}

/** A fix-method step: an allowed fix action at a point inside the screen. */
const isFixStep = (v: unknown) => isObject(v) && FIX_ACTIONS.has(v.action as StepAction) && parseStep(v) !== null;

function isFixMethod(v: unknown): v is FixMethod {
  return isObject(v) && isStr(v.id) && isStr(v.element) && typeof v.flow === 'string' && Array.isArray(v.steps) && v.steps.length > 0
    && v.steps.every(isFixStep) && isNum(v.uses) && isNum(v.successes) && isNum(v.savedAt);
}

/** The stored fix methods with their steps normalised to pending; invalid entries are dropped. */
export function loadFixMethods(): FixMethod[] {
  return listOf(readJson(KEYS.fixMethods), isFixMethod, FIX_METHOD_LIMIT).map((m) => ({ ...m, steps: m.steps.map(fixStep) }));
}

/** A validated stored fix step as a pending step without a screenshot. */
function fixStep(v: unknown): WorkflowStep {
  const { refFrame: _refFrame, ...s } = parseStep(v)!;
  return s;
}

/** Persists the fix methods, capped at FIX_METHOD_LIMIT. */
export function saveFixMethods(methods: FixMethod[]) {
  writeJson(KEYS.fixMethods, methods.slice(0, FIX_METHOD_LIMIT));
}

/** Persists the triggers, capped at TRIGGER_LIMIT. */
export function saveTriggers(triggers: Trigger[]) {
  writeJson(KEYS.triggers, triggers.slice(0, TRIGGER_LIMIT));
}

/** The stored operation memory (failure reminders and notes); invalid entries are dropped. */
export function loadOperationMemory(): OperationMemory {
  const stored = readJson(KEYS.memory);
  if (!isObject(stored)) return EMPTY_MEMORY;
  return { failures: listOf(stored.failures, isFailureRecord, FAILURE_LIMIT), notes: listOf(stored.notes, isOperationNote, OPERATION_NOTE_LIMIT) };
}

/** Persists the operation memory, capped per list; when it does not fit, retries without the failure screenshots. */
export function saveOperationMemory(memory: OperationMemory) {
  const kept = { failures: memory.failures.slice(0, FAILURE_LIMIT), notes: memory.notes.slice(0, OPERATION_NOTE_LIMIT) };
  if (!writeJson(KEYS.memory, kept)) writeJson(KEYS.memory, { ...kept, failures: kept.failures.map((f) => ({ ...f, shots: [] })) });
/** The stored access-path profiles; invalid entries are dropped. */
export const loadAccessPaths = (): AccessProfile[] => listOf(readJson(KEYS.accessPaths), isAccessProfile, ACCESS_PATH_LIMIT);

/** Persists the access-path profiles, capped at ACCESS_PATH_LIMIT. */
export function saveAccessPaths(profiles: AccessProfile[]) {
  writeJson(KEYS.accessPaths, profiles.slice(0, ACCESS_PATH_LIMIT));
}

/** The stored approval queue (newest first); invalid entries are dropped. */
export const loadApprovals = (): ApprovalItem[] => listOf(readJson(KEYS.approvals), isApprovalItem, APPROVAL_LIMIT);

/** Persists the approval queue, capped at APPROVAL_LIMIT. */
export function saveApprovals(items: ApprovalItem[]) {
  writeJson(KEYS.approvals, items.slice(0, APPROVAL_LIMIT));
}

/** Every actor's stored portfolio entries; invalid entries are dropped. */
export const loadPortfolios = (): PortfolioEntry[] => listOf(readJson(KEYS.portfolios), isPortfolioEntry, PORTFOLIO_LIMIT);

/** Persists the portfolio entries, capped at PORTFOLIO_LIMIT. */
export function savePortfolios(entries: PortfolioEntry[]) {
  writeJson(KEYS.portfolios, entries.slice(0, PORTFOLIO_LIMIT));
}

/** A stored variation with its valid steps (their run status kept), or null. */
function parseVariation(v: unknown): Variation | null {
  if (!isObject(v) || typeof v.id !== 'string' || typeof v.goal !== 'string' || !VARIATION_STATUSES.includes(v.status as VariationStatus)
    || typeof v.reason !== 'string' || !isNum(v.created) || !isNum(v.updated) || !Array.isArray(v.steps)) return null;
  const steps = v.steps.flatMap((raw: unknown) => {
    const step = parseStep(raw);
    if (!step) return [];
    const { refFrame: _frame, ...s } = step;
    const status = isObject(raw) && STEP_STATUSES.includes(raw.status as StepStatus) && raw.status !== 'running' ? raw.status as StepStatus : 'pending';
    return [{ ...s, status }];
  });
  return { id: v.id, goal: v.goal, steps, status: v.status as VariationStatus, reason: v.reason, created: v.created, updated: v.updated };
}

/** The stored background variations (newest first); invalid entries are dropped. */
export function loadVariations(): Variation[] {
  const stored = readJson(KEYS.variations);
  return Array.isArray(stored) ? stored.map(parseVariation).filter((v): v is Variation => v !== null).slice(0, VARIATION_LIMIT) : [];
}

/** Persists the background variations, capped at VARIATION_LIMIT. */
export function saveVariations(variations: Variation[]) {
  writeJson(KEYS.variations, variations.slice(0, VARIATION_LIMIT));
}

/** The stored user-profile events; invalid entries are dropped. */
export const loadProfile = (): ProfileEvent[] => listOf(readJson(KEYS.profile), isProfileEvent, PROFILE_LIMIT);

/** Persists the user-profile events, capped at PROFILE_LIMIT. */
export function saveProfile(events: ProfileEvent[]) {
  writeJson(KEYS.profile, events.slice(0, PROFILE_LIMIT));
}

/** The stored knowledge sections; invalid sections are dropped. */
export const loadSections = (): KnowledgeSection[] => listOf(readJson(KEYS.sections), isKnowledgeSection, SECTION_LIMIT);

/** Persists the knowledge sections, capped at SECTION_LIMIT. */
export function saveSections(sections: KnowledgeSection[]) {
const isBox = (v: unknown) => isObject(v) && isNum(v.x) && isNum(v.y) && isNum(v.w) && isNum(v.h);

function isSectionEvent(v: unknown): v is SectionEvent {
  return isObject(v) && isNum(v.time) && (v.kind === 'log' || v.kind === 'change') && typeof v.text === 'string' && (v.box === undefined || isBox(v.box));
}

function isSection(v: unknown): v is ScreenSection {
  return isObject(v) && isStr(v.id) && isStr(v.name) && isBox(v.box) && (v.source === 'drawn' || v.source === 'ai') && Array.isArray(v.events);
}

/** The stored screen sections with their histories; invalid sections and events are dropped. */
export const loadSections = (): ScreenSection[] =>
  listOf(readJson(KEYS.sections), isSection, SECTION_LIMIT).map((s) => ({ ...s, events: listOf(s.events, isSectionEvent, SECTION_EVENT_LIMIT) }));

/** Persists the screen sections, capped at SECTION_LIMIT. */
export function saveSections(sections: ScreenSection[]) {
  writeJson(KEYS.sections, sections.slice(0, SECTION_LIMIT));
const isCategory = (v: unknown) => INITIATIVE_CATEGORIES.includes(v as InitiativeCategory);

function isInitiativeProposal(v: unknown): v is InitiativeProposal {
  return isObject(v) && isStr(v.id) && isNum(v.time) && isCategory(v.category) && isStr(v.text)
    && INITIATIVE_STATUSES.includes(v.status as InitiativeStatus)
    && (v.step === undefined || isObject(v.step)) && (v.edits === undefined || Array.isArray(v.edits)) && (v.pack === undefined || (isObject(v.pack) && Array.isArray(v.pack.steps)));
}

function isInitiativeEntry(v: unknown): v is InitiativeEntry {
  return isObject(v) && isStr(v.id) && isNum(v.time) && isCategory(v.category) && typeof v.text === 'string' && typeof v.ok === 'boolean';
}

function isStressReport(v: unknown): v is StressReport {
  return isObject(v) && isStr(v.id) && isNum(v.time) && typeof v.target === 'string' && isNum(v.attempts) && isNum(v.succeeded)
    && isNum(v.reliability) && isObject(v.byAction) && typeof v.dryRun === 'boolean';
}

/** The stored AI initiative proposals, log and stress reports; invalid entries are dropped. */
export function loadInitiative(): InitiativeState {
  const stored = readJson(KEYS.initiative);
  if (!isObject(stored)) return EMPTY_INITIATIVE;
  return { proposals: listOf(stored.proposals, isInitiativeProposal, INITIATIVE_PROPOSAL_LIMIT), log: listOf(stored.log, isInitiativeEntry, INITIATIVE_LOG_LIMIT), stress: listOf(stored.stress, isStressReport, STRESS_LIMIT) };
}

/** Persists the AI initiative state, capped per list. */
export function saveInitiative(state: InitiativeState) {
  writeJson(KEYS.initiative, { proposals: state.proposals.slice(0, INITIATIVE_PROPOSAL_LIMIT), log: state.log.slice(0, INITIATIVE_LOG_LIMIT), stress: state.stress.slice(0, STRESS_LIMIT) });
}
