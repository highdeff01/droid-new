import { afterEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_MAX, STALE_KEEP, STALE_PARSE_LIMIT, estimateTokens, historyChangeText, historyStats, trimHistory, type HistoryChange, type HistoryEntry } from './ai-history.js';
import { createAiSession } from './ai.js';

const cfg = { url: 'http://model.test/api/chat', model: 'test-model' };
const reply = (content: string) => new Response(JSON.stringify({ message: { role: 'assistant', content } }));
const entries = (n: number): HistoryEntry[] => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}`, time: i }));

function memoryStore(initial?: HistoryEntry[]) {
  const saved = new Map<string, string>();
  if (initial) saved.set('droid-assist.ai-history', JSON.stringify(initial));
  return { saved, getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) };
}

const persisted = (store: ReturnType<typeof memoryStore>) => JSON.parse(store.saved.get('droid-assist.ai-history') ?? 'null') as HistoryEntry[];

afterEach(() => vi.unstubAllGlobals());

describe('history helpers', () => {
  it('estimates size in characters and ~4-char tokens', () => {
    expect(estimateTokens('abcde')).toBe(2);
    expect(historyStats([{ role: 'user', content: 'abcd' }, { role: 'assistant', content: 'abcdefghi' }])).toEqual({ messages: 2, chars: 13, tokens: 4 });
  });

  it('trimHistory keeps the newest n and clamps n', () => {
    expect(trimHistory(entries(5), 2).map((e) => e.content)).toEqual(['m3', 'm4']);
    expect(trimHistory(entries(3), 10)).toHaveLength(3);
    expect(trimHistory(entries(3), -1)).toEqual([]);
  });

  it('describes every kind of change', () => {
    expect(historyChangeText({ reason: 'manual', before: 6, after: 2 })).toContain('last 2');
    expect(historyChangeText({ reason: 'reset', before: 6, after: 0 })).toContain('cleared 6');
    expect(historyChangeText({ reason: 'stale', before: 8, after: STALE_KEEP })).toContain('Stale context');
    expect(historyChangeText({ reason: 'cap', before: 22, after: HISTORY_MAX })).toContain('cap');
  });
});

describe('AI session history management', () => {
  it('trim keeps the newest n messages, persists and reports the change', () => {
    const store = memoryStore(entries(6));
    const changes: HistoryChange[] = [];
    const session = createAiSession(store, undefined, (c) => changes.push(c));
    session.trim(2);
    expect(session.history().map((e) => e.content)).toEqual(['m4', 'm5']);
    expect(persisted(store)).toHaveLength(2);
    expect(changes).toEqual([{ reason: 'manual', before: 6, after: 2 }]);
  });

  it('reset clears the history, persists [] and cancels the request in flight', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const store = memoryStore(entries(4));
    const changes: HistoryChange[] = [];
    const session = createAiSession(store, undefined, (c) => changes.push(c));
    const pending = session.ask(cfg, { system: 's', prompt: 'p' });
    session.reset();
    await expect(pending).rejects.toThrow('AI request cancelled');
    expect(session.history()).toEqual([]);
    expect(persisted(store)).toEqual([]);
    expect(changes).toEqual([{ reason: 'reset', before: 4, after: 0 }]);
  });

  it('after reset the next request carries no prior turns', async () => {
    const fn = vi.fn(async () => reply('fresh'));
    vi.stubGlobal('fetch', fn);
    const session = createAiSession(memoryStore(entries(4)));
    session.reset();
    await session.ask(cfg, { system: 's', prompt: 'p' });
    const body = JSON.parse((fn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
  });

  it('timestamps each recorded turn but sends only role and content', async () => {
    const fn = vi.fn(async () => reply('ok'));
    vi.stubGlobal('fetch', fn);
    const session = createAiSession(memoryStore([{ role: 'user', content: 'old', time: 5 }]));
    await session.ask(cfg, { system: 's', prompt: 'p' });
    const body = JSON.parse((fn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[1]).toEqual({ role: 'user', content: 'old' });
    expect(session.history().slice(1).every((e) => typeof e.time === 'number')).toBe(true);
  });

  it('cap guard trims to HISTORY_MAX and reports it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply('ok')));
    const changes: HistoryChange[] = [];
    const session = createAiSession(memoryStore(entries(HISTORY_MAX - 1)), undefined, (c) => changes.push(c));
    await session.ask(cfg, { system: 's', prompt: 'p' });
    expect(session.history()).toHaveLength(HISTORY_MAX);
    expect(changes).toEqual([{ reason: 'cap', before: HISTORY_MAX + 1, after: HISTORY_MAX }]);
  });

  it('stale-context guard trims after consecutive parse failures only', () => {
    const store = memoryStore(entries(10));
    const changes: HistoryChange[] = [];
    const session = createAiSession(store, undefined, (c) => changes.push(c));
    session.noteParse(false);
    session.noteParse(true);
    for (let i = 0; i < STALE_PARSE_LIMIT - 1; i++) session.noteParse(false);
    expect(changes).toEqual([]);
    expect(session.history()).toHaveLength(10);
    session.noteParse(false);
    expect(changes).toEqual([{ reason: 'stale', before: 10, after: STALE_KEEP }]);
    expect(session.history().map((e) => e.content)).toEqual(['m6', 'm7', 'm8', 'm9']);
    expect(persisted(store)).toHaveLength(STALE_KEEP);
    session.noteParse(false);
    expect(changes).toHaveLength(1);
  });
});
