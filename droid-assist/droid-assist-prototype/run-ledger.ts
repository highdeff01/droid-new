import type { JointApp } from './main-bridge-protocol.js';

/**
 * The unified run ledger: one shared timeline of every step, verdict and handoff of a joint
 * operation. Both apps keep the same entries — a local one is sent over the bridge and a remote
 * one is merged in — so joint operations stop producing two separate histories.
 */

/** What a ledger entry records. */
export type LedgerKind = 'step' | 'verdict' | 'handoff' | 'approval' | 'error' | 'note';
export const LEDGER_KINDS: readonly LedgerKind[] = ['step', 'verdict', 'handoff', 'approval', 'error', 'note'];

/** One entry of the shared timeline. */
export interface LedgerEntry {
  /** Stable identity: the same entry merged twice stays one entry. */
  id: string;
  /** Which app the entry came from. */
  app: JointApp;
  time: number;
  kind: LedgerKind;
  /** 0-based step the entry is about; absent for run-level entries. */
  stepIndex?: number;
  text: string;
  /** verdict/approval: how it came out. */
  ok?: boolean;
}

/** Newest entries kept on the ledger. */
export const LEDGER_LIMIT = 300;

/** A new ledger entry, with a stable id derived from its app, kind, step and time. */
export function entry(app: JointApp, kind: LedgerKind, text: string, at = Date.now(), stepIndex?: number, ok?: boolean): LedgerEntry {
  return { id: `${app}:${kind}:${stepIndex ?? '-'}:${at}`, app, time: at, kind, text, ...(stepIndex === undefined ? {} : { stepIndex }), ...(ok === undefined ? {} : { ok }) };
}

/** Prepends an entry, capped and newest first. */
export const pushEntry = (list: readonly LedgerEntry[], e: LedgerEntry): LedgerEntry[] => [e, ...list.filter((x) => x.id !== e.id)].slice(0, LEDGER_LIMIT);

/**
 * Merges two ledgers as a union by id, newest first, capped. Nothing is dropped except by the cap:
 * an entry only one side saw survives, so a joint operation has one history, not two.
 */
export function mergeLedger(a: readonly LedgerEntry[], b: readonly LedgerEntry[]): LedgerEntry[] {
  const byId = new Map<string, LedgerEntry>();
  for (const e of [...a, ...b]) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort((x, y) => y.time - x.time).slice(0, LEDGER_LIMIT);
}

/** The entries neither side has already: what to send so the other side catches up. */
export const ledgerDelta = (local: readonly LedgerEntry[], sent: ReadonlySet<string>): LedgerEntry[] =>
  local.filter((e) => !sent.has(e.id));

/** One line for the timeline and the log. */
export function ledgerLine(e: LedgerEntry): string {
  const step = e.stepIndex === undefined ? '' : ` step ${e.stepIndex + 1}`;
  const verdict = e.ok === undefined ? '' : e.ok ? ' ✓' : ' ✗';
  return `[${e.app}${step}] ${e.kind}: ${e.text}${verdict}`;
}

/** Totals per app: how many entries each contributed and how many verdicts passed. */
export function ledgerTotals(list: readonly LedgerEntry[]): Record<JointApp, { entries: number; passed: number; failed: number }> {
  const out: Record<JointApp, { entries: number; passed: number; failed: number }> = { 'droid-new': { entries: 0, passed: 0, failed: 0 }, 'droid-main': { entries: 0, passed: 0, failed: 0 } };
  for (const e of list) {
    out[e.app].entries += 1;
    if (e.ok === true) out[e.app].passed += 1;
    else if (e.ok === false) out[e.app].failed += 1;
  }
  return out;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A wire ledger entry is well formed (used to validate what arrives over the bridge). */
export const isLedgerEntry = (v: unknown): v is LedgerEntry =>
  isObject(v) && typeof v.id === 'string' && (v.app === 'droid-new' || v.app === 'droid-main') && isNum(v.time)
  && LEDGER_KINDS.includes(v.kind as LedgerKind) && typeof v.text === 'string'
  && (v.stepIndex === undefined || isNum(v.stepIndex)) && (v.ok === undefined || typeof v.ok === 'boolean');

/** A wire ledger entry list is well formed. */
export const isLedgerEntries = (v: unknown): v is LedgerEntry[] => Array.isArray(v) && v.every(isLedgerEntry);
