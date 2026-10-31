import { describe, expect, it } from 'vitest';
import { LEDGER_LIMIT, entry, isLedgerEntries, isLedgerEntry, ledgerDelta, ledgerLine, ledgerTotals, mergeLedger, pushEntry, type LedgerEntry } from './run-ledger.js';

const at = (id: string, time: number, app: 'droid-new' | 'droid-main' = 'droid-new', ok?: boolean) => entry(app, 'step', id, time, 0, ok);

describe('entry', () => {
  it('gives the same entry a stable id from its app, kind, step and time', () => {
    expect(entry('droid-new', 'verdict', 'ok', 10, 2, true).id).toBe('droid-new:verdict:2:10');
    expect(entry('droid-main', 'note', 'x', 5).id).toBe('droid-main:note:-:5');
  });

  it('omits stepIndex and ok when they are not given', () => {
    const e = entry('droid-new', 'note', 'hello', 1);
    expect('stepIndex' in e).toBe(false);
    expect('ok' in e).toBe(false);
  });
});

describe('pushEntry', () => {
  it('prepends newest first and does not duplicate an id', () => {
    const a = at('a', 1);
    const b = at('b', 2);
    expect(pushEntry(pushEntry([a], b), a).map((e) => e.id)).toEqual([a.id, b.id]);
  });

  it('caps the ledger', () => {
    let list: LedgerEntry[] = [];
    for (let i = 0; i < LEDGER_LIMIT + 10; i++) list = pushEntry(list, at(`e${i}`, i));
    expect(list).toHaveLength(LEDGER_LIMIT);
  });
});

describe('mergeLedger', () => {
  it('unions by id, newest first, so nothing one side saw is dropped', () => {
    const local = [at('a', 1), at('b', 3)];
    const remote = [at('b', 3, 'droid-main'), at('c', 2, 'droid-main')];
    expect(mergeLedger(local, remote).map((e) => e.id)).toEqual(['droid-new:step:0:3', 'droid-main:step:0:3', 'droid-main:step:0:2', 'droid-new:step:0:1']);
  });

  it('keeps one entry when both sides send the same id', () => {
    const local = [at('a', 1)];
    const remote = [entry('droid-new', 'step', 'a', 1, 0)];
    expect(mergeLedger(local, remote)).toHaveLength(1);
    expect(mergeLedger(local, remote)[0].text).toBe('a');
  });
});

describe('ledgerDelta', () => {
  it('sends only entries the other side has not seen', () => {
    const list = [at('a', 1), at('b', 2)];
    expect(ledgerDelta(list, new Set(['droid-new:step:0:1'])).map((e) => e.id)).toEqual(['droid-new:step:0:2']);
  });
});

describe('ledgerLine', () => {
  it('names the app, step and verdict', () => {
    expect(ledgerLine(entry('droid-main', 'verdict', 'step done', 1, 0, true))).toBe('[droid-main step 1] verdict: step done ✓');
    expect(ledgerLine(entry('droid-new', 'note', 'hi', 1))).toBe('[droid-new] note: hi');
  });
});

describe('ledgerTotals', () => {
  it('counts entries and verdicts per app', () => {
    const totals = ledgerTotals([entry('droid-new', 'step', 'a', 1, 0, true), entry('droid-new', 'step', 'b', 2, 1, false), entry('droid-main', 'step', 'c', 3, 0, true)]);
    expect(totals['droid-new']).toEqual({ entries: 2, passed: 1, failed: 1 });
    expect(totals['droid-main']).toEqual({ entries: 1, passed: 1, failed: 0 });
  });
});

describe('isLedgerEntry', () => {
  it('accepts a well formed entry and rejects a malformed one', () => {
    expect(isLedgerEntry({ id: 'x', app: 'droid-new', time: 1, kind: 'step', text: 'ok' })).toBe(true);
    expect(isLedgerEntry({ id: 'x', app: 'other', time: 1, kind: 'step', text: 'ok' })).toBe(false);
    expect(isLedgerEntry({ id: 'x', app: 'droid-new', time: 1, kind: 'bogus', text: 'ok' })).toBe(false);
    expect(isLedgerEntry({ id: 'x', app: 'droid-new', time: 1, kind: 'step' })).toBe(false);
  });

  it('validates a list', () => {
    expect(isLedgerEntries([{ id: 'x', app: 'droid-new', time: 1, kind: 'step', text: 'ok' }])).toBe(true);
    expect(isLedgerEntries([{ id: 'x' }])).toBe(false);
  });
});
