import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiError, DEFAULT_AI_MODEL, DEFAULT_AI_URL, chat, createAiSession, parseJsonReply, pingAi, toUnit } from './ai.js';
import type { Frame } from './types.js';

const cfg = { url: 'http://model.test/api/chat', model: 'test-model' };
const reply = (content: unknown, status = 200) => new Response(JSON.stringify({ message: { role: 'assistant', content } }), { status });
const frame = { url: 'data:image/jpeg;base64,QUJD' } as Frame;

function stubFetch(...responses: Array<Response | Error>) {
  const fn = vi.fn(async () => {
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return r ?? reply('none');
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const bodyOf = (fn: ReturnType<typeof stubFetch>, call = 0) => JSON.parse((fn.mock.calls[call] as unknown as [string, RequestInit])[1].body as string);

afterEach(() => vi.unstubAllGlobals());

describe('ai defaults', () => {
  it('targets the quantumclaw endpoint with qwen3.5:2b', () => {
    expect(DEFAULT_AI_URL).toBe('https://quantumclaw.net/ollama/api/chat');
    expect(DEFAULT_AI_MODEL).toBe('qwen3.5:2b');
  });
});

describe('chat', () => {
  it('posts a non-streaming Ollama chat to the configured URL and returns message.content', async () => {
    const fn = stubFetch(reply(' hello '));
    await expect(chat(cfg, [{ role: 'user', content: 'hi' }])).resolves.toBe('hello');
    expect((fn.mock.calls[0] as unknown as [string])[0]).toBe(cfg.url);
    expect(bodyOf(fn)).toMatchObject({ model: 'test-model', stream: false, messages: [{ role: 'user', content: 'hi' }] });
  });

  it('rejects with the HTTP status on a non-OK reply', async () => {
    stubFetch(new Response(JSON.stringify({ error: 'model not found' }), { status: 404 }));
    await expect(chat(cfg, [])).rejects.toThrow(/HTTP 404: model not found/);
  });

  it('rejects when the endpoint is unreachable', async () => {
    stubFetch(new TypeError('Failed to fetch'));
    await expect(chat(cfg, [])).rejects.toThrow(/unreachable.*Failed to fetch/);
  });

  it('rejects an empty or missing message.content', async () => {
    stubFetch(reply(''));
    await expect(chat(cfg, [])).rejects.toBeInstanceOf(AiError);
  });
});

describe('pingAi', () => {
  it('reports online when the model answers', async () => {
    stubFetch(reply('OK'));
    expect((await pingAi(cfg)).state).toBe('online');
  });

  it('reports offline with the reason when the endpoint fails', async () => {
    stubFetch(new TypeError('Failed to fetch'));
    const status = await pingAi(cfg);
    expect(status.state).toBe('offline');
    expect(status.detail).toMatch(/Failed to fetch/);
  });
});

describe('parseJsonReply / toUnit', () => {
  it('parses a fenced JSON object and strips think blocks', () => {
    expect(parseJsonReply('<think>{"no":1}</think>```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });

  it('rejects non-JSON text', () => {
    expect(() => parseJsonReply('hello')).toThrow(AiError);
  });

  it('keeps fractions, scales pixels and clamps', () => {
    expect(toUnit(0.25, 480)).toBe(0.25);
    expect(toUnit(240, 480)).toBe(0.5);
    expect(toUnit(-3, 480)).toBe(0);
    expect(() => toUnit('abc', 480)).toThrow(AiError);
  });
});

describe('createAiSession', () => {
  it('sends the frame as bare base64, carries history and persists it', async () => {
    const saved = new Map<string, string>();
    const store = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) };
    const fn = stubFetch(reply('first'), reply('second'));
    const session = createAiSession(store);
    await session.ask(cfg, { system: 'sys', prompt: 'look', frame, context: ['[You] clicked'] });
    await session.ask(cfg, { system: 'sys', prompt: 'again' });
    const first = bodyOf(fn, 0).messages;
    expect(first[1]).toMatchObject({ role: 'user', images: ['QUJD'] });
    expect(first[1].content).toContain('[You] clicked');
    const second = bodyOf(fn, 1).messages.map((m: { role: string; content: string }) => [m.role, m.content]);
    expect(second.slice(2, 3)).toEqual([['assistant', 'first']]);
    expect(createAiSession(store).history()).toHaveLength(4);
  });

  it('does not record a failed turn', async () => {
    stubFetch(new TypeError('down'));
    const session = createAiSession(null);
    await expect(session.ask(cfg, { system: 's', prompt: 'p' })).rejects.toThrow(AiError);
    expect(session.history()).toHaveLength(0);
  });
});
