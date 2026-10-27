import type { Frame, LogEntry } from './types.js';
import { uid } from './planner.js';

/** What failed: the AI, a step, drift (red), the desktop bridge, the self-test watcher run, or the Settings test. */
export type ErrorKind = 'ai' | 'step' | 'drift' | 'bridge' | 'watcher' | 'test' | 'main-app';

/** The structured report POSTed to the error-fix endpoint. */
export interface ErrorReport {
  id: string;
  /** ISO 8601 time of capture. */
  timestamp: string;
  kind: ErrorKind;
  message: string;
  /** The goal being worked on, when there is one. */
  goal: string | null;
  /** The failing step, when the error is about one. */
  step: string | null;
  /** The newest activity-log lines, "[source] message", newest first. */
  recentLog: string[];
  /** The current frame as a JPEG data URL, or null when nothing is captured. */
  screenshot: string | null;
}

/** Delivery state of a listed error. */
export type DeliveryStatus = 'not sent' | 'sending' | 'sent' | 'outbox';

/** A captured error as listed in the Errors panel. */
export interface ForwardedError {
  report: ErrorReport;
  status: DeliveryStatus;
  /** Captures of the same error suppressed by the duplicate window. */
  repeats: number;
  /** Outcome of the last send. */
  detail?: string;
}

/** Last-known status of the error-fix endpoint. */
export interface EndpointStatus {
  state: 'unknown' | 'ok' | 'failed';
  time: number | null;
  detail: string;
}

/** Outcome of delivering one report. */
export interface DeliveryResult {
  ok: boolean;
  detail: string;
  attempts: number;
}

/** Same kind + message + step within this window is captured once. */
export const DUPLICATE_WINDOW_MS = 60_000;
/** Most reports kept in the persisted outbox. */
export const OUTBOX_LIMIT = 10;
/** Activity-log lines attached to a report. */
export const LOG_CONTEXT = 8;
/** A send that has not answered by then counts as failed. */
export const SEND_TIMEOUT_MS = 8_000;
/** Pause before the single retry of an automatic send. */
export const RETRY_DELAY_MS = 1_000;

export const ERROR_KINDS: readonly ErrorKind[] = ['ai', 'step', 'drift', 'bridge', 'watcher', 'test', 'main-app'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** `text` with every occurrence of the auth token masked. */
export function redact(text: string, token: string): string {
  return token ? text.split(token).join('***') : text;
}

/** What a capture site knows about the failure. */
export interface CaptureInput {
  kind: ErrorKind;
  message: string;
  goal?: string;
  step?: string;
}

/** Builds a report with context: the newest log lines (token masked) and the current frame. */
export function buildReport(input: CaptureInput, log: LogEntry[], frame: Frame | null, token: string, now = Date.now()): ErrorReport {
  return {
    id: uid('err'),
    timestamp: new Date(now).toISOString(),
    kind: input.kind,
    message: redact(input.message, token),
    goal: input.goal?.trim() || null,
    step: input.step || null,
    recentLog: log.slice(0, LOG_CONTEXT).map((l) => redact(`[${l.source}] ${l.message}`, token)),
    screenshot: frame?.url ?? null,
  };
}

/** Identity of an error for duplicate suppression. */
export const dedupeKey = (r: Pick<ErrorReport, 'kind' | 'message' | 'step'>) => `${r.kind}|${r.step ?? ''}|${r.message}`;

/**
 * True when the same error was seen within the window; otherwise records it as seen at `now`.
 * Entries older than the window are pruned.
 */
export function suppressDuplicate(seen: Map<string, number>, key: string, now = Date.now()): boolean {
  for (const [k, t] of seen) if (now - t >= DUPLICATE_WINDOW_MS) seen.delete(k);
  if (seen.has(key)) return true;
  seen.set(key, now);
  return false;
}

/** One POST of the report as JSON; the token goes as a Bearer Authorization header only. */
export async function postReport(url: string, token: string, report: ErrorReport): Promise<{ ok: boolean; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(report), signal: controller.signal });
    return res.ok ? { ok: true, detail: `HTTP ${res.status}` } : { ok: false, detail: `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, detail: controller.signal.aborted ? `no answer within ${SEND_TIMEOUT_MS / 1000}s` : redact(errorText(error), token) };
  } finally {
    clearTimeout(timer);
  }
}

/** Posts the report, retrying `retries` times after `delayMs` on failure. */
export async function deliver(url: string, token: string, report: ErrorReport, retries: number, delayMs = RETRY_DELAY_MS): Promise<DeliveryResult> {
  let last = { ok: false, detail: 'not sent' };
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    if (attempt > 1) await sleep(delayMs);
    last = await postReport(url, token, report);
    if (last.ok) return { ...last, attempts: attempt };
  }
  return { ...last, attempts: retries + 1 };
}

/** True when `v` has the shape of a stored report. */
export function isErrorReport(v: unknown): v is ErrorReport {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  const optString = (x: unknown) => x === null || typeof x === 'string';
  return typeof r.id === 'string' && typeof r.timestamp === 'string' && ERROR_KINDS.includes(r.kind as ErrorKind)
    && typeof r.message === 'string' && optString(r.goal) && optString(r.step) && optString(r.screenshot)
    && Array.isArray(r.recentLog) && r.recentLog.every((l) => typeof l === 'string');
}
