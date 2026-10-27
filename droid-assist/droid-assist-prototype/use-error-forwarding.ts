import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AssistSettings, Frame, LogEntry } from './types.js';
import { buildReport, dedupeKey, deliver, redact, suppressDuplicate, type CaptureInput, type DeliveryResult, type EndpointStatus, type ErrorReport, type ForwardedError } from './error-forwarding.js';
import { loadOutbox, saveOutbox } from './storage.js';

/** Errors listed in the panel. */
export const ERROR_LIST_LIMIT = 30;
/** Log source of every forwarding line. */
const SOURCE = 'Errors';

/** What a report is built from at the moment of capture. */
export interface ErrorContext {
  log: LogEntry[];
  frame: Frame | null;
}

type AddLog = (from: string, message: string, tone?: LogEntry['tone']) => void;

const sampleReport = (ctx: ErrorContext, token: string): ErrorReport =>
  buildReport({ kind: 'test', message: 'Test error from Droid Assist — the error-fix endpoint is reachable' }, ctx.log, ctx.frame, token);

/**
 * Error forwarding: captures structured error reports, POSTs them to the configured error-fix
 * endpoint in the background (one retry, then the persisted outbox), suppresses duplicates and
 * tracks the endpoint's last-known status. Nothing here blocks the caller.
 */
export function useErrorForwarding(settings: AssistSettings, addLog: AddLog, context: () => ErrorContext, onOutcome?: (what: string, ok: boolean, detail: string) => void) {
  const [errors, setErrors] = useState<ForwardedError[]>(() => loadOutbox().map((report) => ({ report, status: 'outbox', repeats: 0 })));
  const [endpoint, setEndpoint] = useState<EndpointStatus>({ state: 'unknown', time: null, detail: 'Nothing sent yet' });
  const settingsRef = useRef(settings);
  const contextRef = useRef(context);
  const onOutcomeRef = useRef(onOutcome);
  const seenRef = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    settingsRef.current = settings;
    contextRef.current = context;
    onOutcomeRef.current = onOutcome;
  });

  useEffect(() => saveOutbox(errors.filter((e) => e.status === 'outbox').map((e) => e.report)), [errors]);

  const patch = useCallback((id: string, change: Partial<ForwardedError>) => {
    setErrors((list) => list.map((e) => (e.report.id === id ? { ...e, ...change } : e)));
  }, []);

  /** Records an attempt's outcome on the endpoint status and in the activity log (token masked). */
  const noteOutcome = useCallback((what: string, r: DeliveryResult) => {
    const { errorToken } = settingsRef.current;
    const detail = redact(`${r.detail}${r.attempts > 1 ? ` after ${r.attempts} attempts` : ''}`, errorToken);
    setEndpoint({ state: r.ok ? 'ok' : 'failed', time: Date.now(), detail });
    addLog(SOURCE, redact(`${what} ${r.ok ? 'delivered' : 'not delivered'} — ${detail}`, errorToken), r.ok ? 'ok' : 'error');
    onOutcomeRef.current?.(redact(what, errorToken), r.ok, detail);
  }, [addLog]);

  /** Delivers a listed report; a failure lands it in the outbox. */
  const send = useCallback(async (report: ErrorReport, retries: number) => {
    const { errorUrl, errorToken } = settingsRef.current;
    if (!errorUrl.trim()) {
      addLog(SOURCE, 'No error endpoint set — add one under Error forwarding', 'warn');
      return;
    }
    patch(report.id, { status: 'sending' });
    const r = await deliver(errorUrl.trim(), errorToken, report, retries);
    patch(report.id, { status: r.ok ? 'sent' : 'outbox', detail: redact(r.detail, errorToken) });
    noteOutcome(`${report.kind} error "${report.message.slice(0, 80)}"`, r);
  }, [addLog, noteOutcome, patch]);

  /** Captures an error; forwarded in the background when enabled, suppressed when seen within the window. */
  const capture = useCallback((input: CaptureInput) => {
    const { errorForwarding, errorUrl, errorToken } = settingsRef.current;
    const key = dedupeKey({ kind: input.kind, message: redact(input.message, errorToken), step: input.step || null });
    if (suppressDuplicate(seenRef.current, key)) {
      setErrors((list) => {
        const i = list.findIndex((e) => dedupeKey(e.report) === key);
        return i < 0 ? list : list.map((e, j) => (j === i ? { ...e, repeats: e.repeats + 1 } : e));
      });
      return;
    }
    const ctx = contextRef.current();
    const report = buildReport(input, ctx.log, ctx.frame, errorToken);
    const forward = errorForwarding && !!errorUrl.trim();
    setErrors((list) => [{ report, status: 'not sent' as const, repeats: 0 }, ...list].slice(0, ERROR_LIST_LIMIT));
    if (forward) void send(report, 1);
  }, [send]);

  /** Manual send of a listed error (Send now / Resend): one attempt, no duplicate suppression. */
  const sendNow = useCallback((report: ErrorReport) => send(report, 0), [send]);

  /** Posts a sample report and logs whether the endpoint accepted it. */
  const sendTest = useCallback(async () => {
    const { errorUrl, errorToken } = settingsRef.current;
    if (!errorUrl.trim()) {
      addLog(SOURCE, 'No error endpoint set — add one under Error forwarding', 'warn');
      return;
    }
    const r = await deliver(errorUrl.trim(), errorToken, sampleReport(contextRef.current(), errorToken), 0);
    noteOutcome('Test error', r);
  }, [addLog, noteOutcome]);

  return { errors, endpoint, capture, sendNow, sendTest };
}
