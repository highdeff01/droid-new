import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTO_SAVE_EVERY, HISTORY_WINDOW_DEFAULT, HISTORY_WINDOW_MAX, STALE_KEEP, STALE_PARSE_LIMIT, autoSaveDue, estimateTokens, historyChangeText, historyStats, trimHistory, type HistoryChange, type HistoryEntry } from './ai-history.js';
import { AI_ARCHIVE_KEY, createAiSession, windowTurns } from './ai.js';

const cfg = { url: 'http://model.test/api/chat', model: 'test-model' };
const reply = (content: string) => new Response(JSON.stringify({ message: { role: 'assistant', content } }));
const entries = (n: number): HistoryEntry[] => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}`, time: i }));

function memoryStore(initial?: HistoryEntry[]) {
  const saved = new Map<string, string>();
  if (initial) saved.set('droid-assist.ai-history', JSON.stringify(initial));
  return { saved, getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) };
}

const persisted = (store: ReturnType<typeof memoryStore>) => JSON.parse(store.saved.get('droid-assist.ai-history') ?? 'null') as HistoryEntry[];
const archived = (store: ReturnType<typeof memoryStore>) => JSON.parse(store.saved.get(AI_ARCHIVE_KEY) ?? 'null') as HistoryEntry[];
const bodyOf = (fn: { mock: { calls: unknown[][] } }, call = 0) => JSON.parse((fn.mock.calls[call] as unknown as [string, RequestInit])[1].body as string);

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

  it('never caps the history, sends only the default 50-message window, and archives every turn', async () => {
    const fn = vi.fn(async () => reply('ok'));
    vi.stubGlobal('fetch', fn);
    const changes: HistoryChange[] = [];
    const store = memoryStore(entries(70));
    const session = createAiSession(store, undefined, (c) => changes.push(c));
    await session.ask(cfg, { system: 's', prompt: 'p' });
    expect(HISTORY_WINDOW_DEFAULT).toBe(50);
    expect(session.history()).toHaveLength(72);
    expect(changes).toEqual([]);
    const sent = bodyOf(fn).messages as Array<{ content: string }>;
    expect(sent).toHaveLength(1 + HISTORY_WINDOW_DEFAULT + 1);
    expect(sent[1].content).toBe('m20');
    expect(archived(store)).toHaveLength(2);
  });

  it('sends only the configured read window, up to the 100-message maximum', async () => {
    const fn = vi.fn(async () => reply('ok'));
    vi.stubGlobal('fetch', fn);
    const session = createAiSession(memoryStore(entries(150)));
    await session.ask({ ...cfg, historyWindow: 7 }, { system: 's', prompt: 'p' });
    await session.ask({ ...cfg, historyWindow: HISTORY_WINDOW_MAX }, { system: 's', prompt: 'p' });
    expect(bodyOf(fn, 0).messages).toHaveLength(1 + 7 + 1);
    expect(bodyOf(fn, 1).messages).toHaveLength(1 + HISTORY_WINDOW_MAX + 1);
    expect(windowTurns(entries(3), 2)).toEqual([{ role: 'assistant', content: 'm1' }, { role: 'user', content: 'm2' }]);
  });

  it('the archive survives trim, the stale guard and reset', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply('ok')));
    const store = memoryStore();
    const session = createAiSession(store);
    await session.ask(cfg, { system: 's', prompt: 'a' });
    await session.ask(cfg, { system: 's', prompt: 'b' });
    session.trim(1);
    for (let i = 0; i < STALE_PARSE_LIMIT; i++) session.noteParse(false);
    session.reset();
    expect(session.history()).toEqual([]);
    expect(session.archive().map((e) => e.content)).toEqual(['a', 'ok', 'b', 'ok']);
    expect(archived(store)).toHaveLength(4);
    expect(createAiSession(store).archive()).toHaveLength(4);
  });

  it('auto-saves each time the archive reaches a multiple of 100 messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply('ok')));
    const store = memoryStore();
    store.saved.set(AI_ARCHIVE_KEY, JSON.stringify(entries(AUTO_SAVE_EVERY - 4)));
    const saves: number[] = [];
    const session = createAiSession(store, undefined, undefined, {}, (archive) => saves.push(archive.length));
    await session.ask(cfg, { system: 's', prompt: 'p' });
    expect(saves).toEqual([]);
    await session.ask(cfg, { system: 's', prompt: 'p' });
    expect(saves).toEqual([100]);
    await session.ask(cfg, { system: 's', prompt: 'p' });
    expect(saves).toEqual([100]);
    expect(autoSaveDue(199, 201)).toBe(true);
    expect(autoSaveDue(200, 202)).toBe(false);
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
