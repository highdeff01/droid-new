import { describe, expect, it } from 'vitest';
import type { ActionRecord } from './types.js';
import { HISTORY_KEY, appendHistory, historyToCsv, historyToJson, loadHistory } from './action-history.js';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
};

const rec = (over: Partial<ActionRecord> = {}): ActionRecord => ({
  id: 'a1', time: Date.UTC(2026, 0, 2, 3, 4, 5), action: 'type', x: 120, y: 340, text: 'a,"b"', source: 'Replay', via: 'bridge', ok: true, message: 'Dispatched', ...over,
});

describe('action history', () => {
  it('persists appended records and reloads them newest first', () => {
    const store = memory();
    let h = appendHistory([], rec({ id: 'first' }), store);
    h = appendHistory(h, rec({ id: 'second' }), store);
    expect(loadHistory(store).map((r) => r.id)).toEqual(['second', 'first']);
  });

  it('keeps every record: nothing old is discarded', () => {
    const many = Array.from({ length: 2500 }, (_, i) => rec({ id: String(i) }));
    const next = appendHistory(many, rec({ id: 'new' }), memory());
    expect(next).toHaveLength(2501);
    expect(next.at(-1)!.id).toBe('2499');
  });

  it('returns an empty history for corrupt storage', () => {
    const store = memory();
    store.setItem(HISTORY_KEY, '{not json');
    expect(loadHistory(store)).toEqual([]);
  });

  it('exports CSV with a header and RFC 4180 quoting', () => {
    const [header, row] = historyToCsv([rec()]).split('\r\n');
    expect(header).toBe('time,action,x,y,endX,endY,text,source,via,ok,message,dryRun');
    expect(row).toBe('2026-01-02T03:04:05.000Z,type,120,340,,,"a,""b""",Replay,bridge,true,Dispatched,');
  });

  it('keeps both coordinates of a drag through storage and export', () => {
    const store = memory();
    const drag = rec({ action: 'drag', x: 100, y: 80, endX: 900, endY: 400, text: undefined });
    appendHistory([], drag, store);
    expect(loadHistory(store)[0]).toMatchObject({ action: 'drag', x: 100, y: 80, endX: 900, endY: 400 });
    expect(historyToCsv([drag]).split('\r\n')[1]).toBe('2026-01-02T03:04:05.000Z,drag,100,80,900,400,,Replay,bridge,true,Dispatched,');
    expect(JSON.parse(historyToJson([drag]))[0]).toMatchObject({ endX: 900, endY: 400 });
  });

  it('exports JSON as the array of records', () => {
    expect(JSON.parse(historyToJson([rec()]))).toEqual([rec()]);
  });
});
