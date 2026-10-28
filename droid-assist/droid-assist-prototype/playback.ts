import type { StepAction, WorkflowStep } from './types.js';
import { requestActionHistory, requestHistoryScreenshot, type HistoryRecord } from './bridge.js';

/** Default, shortest and longest playback window, in seconds (the Settings slider). */
export const PLAYBACK_WINDOW_SEC_MIN = 30;
export const PLAYBACK_WINDOW_SEC_MAX = 600;
export const DEFAULT_PLAYBACK_WINDOW_SEC = PLAYBACK_WINDOW_SEC_MIN;
/** How far back a playback reaches by default. */
export const PLAYBACK_WINDOW_MS = DEFAULT_PLAYBACK_WINDOW_SEC * 1000;
/** Fewest history rows requested; longer windows request proportionally more (4 per second). */
export const PLAYBACK_REQUEST_LIMIT = 200;
/** The history rows requested for a window of `windowSec` seconds. */
export const requestLimit = (windowSec: number) => Math.max(PLAYBACK_REQUEST_LIMIT, Math.ceil(windowSec * 4));
/** Native screen size assumed when no live frame tells the real one. */
export const DEFAULT_SCREEN = { w: 1920, h: 1080 };

/** One performed action of the playback: the step that repeats it, its record and the screenshot taken then. */
export interface PlaybackEntry {
  record: HistoryRecord;
  step: WorkflowStep;
  /** Image data URL of the main app's screenshot at that action; null when it has none or it could not be fetched. */
  shot: string | null;
}

/** A reconstructed playback: the window's actions oldest first. */
export interface Playback {
  /** When it was fetched. */
  at: number;
  /** The window it covers, in seconds. */
  windowSec: number;
  entries: PlaybackEntry[];
}

/** The main app's action names, as the step action that repeats them. */
const ACTION_OF: Record<string, StepAction> = {
  click: 'click', left_click: 'click', right_click: 'click', mouse_click: 'click',
  double_click: 'double_click', doubleclick: 'double_click', dblclick: 'double_click',
  move: 'move', mouse_move: 'move', drag: 'drag', scroll: 'scroll',
  type: 'type', type_text: 'type', write: 'type',
  key: 'key', press_key: 'key', hotkey: 'key', keypress: 'key',
};

/** The step action of a record: its named action, else a click (mouse) or typing / a key (keyboard). */
function stepAction(r: HistoryRecord): StepAction {
  const named = ACTION_OF[(r.action ?? '').toLowerCase()];
  if (named) return named;
  if (r.inputKind === 'mouse') return 'click';
  return r.input && r.input.length > 1 && !r.input.includes('+') ? 'type' : 'key';
}

const unit = (v: number | undefined, size: number) => (v === undefined ? 0.5 : Math.min(1, Math.max(0, v / size)));

/** The workflow step that repeats a performed action; native pixels are normalized against the screen size. */
export function recordToStep(r: HistoryRecord, screen: { w: number; h: number }): WorkflowStep {
  const action = stepAction(r);
  const text = action === 'type' || action === 'key' ? r.input ?? '' : undefined;
  const at = new Date(r.timestamp).toLocaleTimeString();
  return {
    id: `playback-${r.id}`,
    name: `${action}${text ? ` "${text}"` : ''} at ${at}`,
    action,
    x: unit(r.x, screen.w),
    y: unit(r.y, screen.h),
    status: 'pending',
    ...(text !== undefined ? { text } : {}),
  };
}

/** The real-input records of the window ending at `now`, oldest first; non-input records are ignored. */
export function lastWindow(records: HistoryRecord[], now: number, windowMs = PLAYBACK_WINDOW_MS): HistoryRecord[] {
  return records
    .filter((r) => !!r.inputKind && r.timestamp <= now && now - r.timestamp <= windowMs)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * The last `windowSec` seconds (default 30) of actions the main app performed, rebuilt as steps with their screenshots.
 * Fails with the bridge's message (HISTORY_UNSUPPORTED when the main app does not serve history).
 */
export async function fetchPlayback(bridgeUrl: string, token: string, screen: { w: number; h: number }, now = Date.now(), windowSec = DEFAULT_PLAYBACK_WINDOW_SEC): Promise<{ ok: true; playback: Playback } | { ok: false; message: string }> {
  const res = await requestActionHistory(bridgeUrl, token, requestLimit(windowSec), windowSec);
  if (!res.ok) return res;
  const records = lastWindow(res.records, now, windowSec * 1000);
  const entries = await Promise.all(records.map(async (record) => ({
    record,
    step: recordToStep(record, screen),
    shot: record.screenshotId ? await requestHistoryScreenshot(bridgeUrl, token, record.screenshotId) : null,
  })));
  return { ok: true, playback: { at: now, windowSec, entries } };
}
