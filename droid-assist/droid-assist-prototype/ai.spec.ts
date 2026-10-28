import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_TIMEOUT_MS_MAX, AI_TIMEOUT_MS_MIN, AiCancelled, AiError, AiParseError, CONTENT_RETRY_LADDER, DEFAULT_AI_MODEL, DEFAULT_AI_TIMEOUT_MS, DEFAULT_AI_URL, FALLBACK_QUESTION_PREFIX, RAW_REPLY_MAX, chat, createAiSession, parseJsonReply, pingAi, thinkingOnlyNotice, toUnit, withMasterPrompt } from './ai.js';
import type { ChatMessage } from './ai.js';
import type { Frame } from './types.js';

const cfg = { url: 'http://model.test/api/chat', model: 'test-model' };
const reply = (content: unknown, status = 200, thinking?: unknown) => new Response(JSON.stringify({ message: { role: 'assistant', content, ...(thinking === undefined ? {} : { thinking }) } }), { status });
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

  it('times out after 90 s by default, within a 10 s – 5 min range', () => {
    expect(DEFAULT_AI_TIMEOUT_MS).toBe(90_000);
    expect(AI_TIMEOUT_MS_MIN).toBe(10_000);
    expect(AI_TIMEOUT_MS_MAX).toBe(300_000);
  });
});

describe('chat', () => {
  it('posts a non-streaming Ollama chat with thinking off by default and returns message.content', async () => {
    const fn = stubFetch(reply(' hello '));
    await expect(chat(cfg, [{ role: 'user', content: 'hi' }])).resolves.toEqual({ content: 'hello', thinking: null });
    expect((fn.mock.calls[0] as unknown as [string])[0]).toBe(cfg.url);
    expect(bodyOf(fn)).toMatchObject({ model: 'test-model', stream: false, think: false, messages: [{ role: 'user', content: 'hi' }] });
  });

  it('sends think as the config asks: false and true are both sent explicitly', async () => {
    const fn = stubFetch(reply('a'), reply('b'));
    await chat({ ...cfg, think: false }, []);
    await chat({ ...cfg, think: true }, []);
    expect(bodyOf(fn, 0).think).toBe(false);
    expect(bodyOf(fn, 1).think).toBe(true);
  });

  it('with thinking on, the thinking-only retry sends think:true again and keeps the reply', async () => {
    const fn = stubFetch(reply('', 200, 't'), reply('ok'));
    await expect(chat({ ...cfg, think: true }, [])).resolves.toEqual({ content: 'ok', thinking: 't' });
    expect(bodyOf(fn, 0).think).toBe(true);
    expect(bodyOf(fn, 1).think).toBe(true);
  });

  it('with thinking off, an empty reply without thinking rejects with no retry', async () => {
    const fn = stubFetch(reply(''));
    await expect(chat({ ...cfg, think: false }, [])).rejects.toThrow(/no message content and no thinking/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns message.thinking alongside the content', async () => {
    stubFetch(reply('{"a":1}', 200, ' The user wants a. '));
    await expect(chat(cfg, [], true)).resolves.toEqual({ content: '{"a":1}', thinking: 'The user wants a.' });
  });

  it('reports thinking as null when it is empty or not a string', async () => {
    stubFetch(reply('x', 200, '  '), reply('y', 200, 42));
    expect((await chat(cfg, [])).thinking).toBeNull();
    expect((await chat(cfg, [])).thinking).toBeNull();
  });

  it('rejects with the HTTP status on a non-OK reply', async () => {
    stubFetch(new Response(JSON.stringify({ error: 'model not found' }), { status: 404 }));
    await expect(chat(cfg, [])).rejects.toThrow(/HTTP 404: model not found/);
  });

  it('rejects when the endpoint is unreachable', async () => {
    stubFetch(new TypeError('Failed to fetch'));
    await expect(chat(cfg, [])).rejects.toThrow(/unreachable.*Failed to fetch/);
  });

  it('rejects an empty message.content without thinking, with no retry', async () => {
    const fn = stubFetch(reply(''));
    await expect(chat(cfg, [])).rejects.toThrow(/no message content and no thinking/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries with a rephrase instruction when the reply was thinking only', async () => {
    const fn = stubFetch(reply('   ', 200, 'Thinking Process: the user wants a...'), reply('{"a":1}', 200, 'Answering now.'));
    await expect(chat(cfg, [{ role: 'user', content: 'hi' }], true)).resolves.toEqual({ content: '{"a":1}', thinking: 'Answering now.' });
    expect(fn).toHaveBeenCalledTimes(2);
    const retried = bodyOf(fn, 1).messages;
    expect(retried[0]).toEqual({ role: 'user', content: 'hi' });
    expect(retried[1]).toEqual({ role: 'user', content: expect.stringMatching(/own words.*message content.*JSON/) });
  });

  it('keeps the first thinking when the retry carries none', async () => {
    stubFetch(reply('', 200, 'first thoughts'), reply('ok'));
    await expect(chat(cfg, [])).resolves.toEqual({ content: 'ok', thinking: 'first thoughts' });
  });

  it('walks the ladder with three differently worded retries: rephrase, short direct answer, JSON only', async () => {
    const fn = stubFetch(reply('', 200, 't0'), reply('', 200, 't1'), reply('', 200, 't2'), reply('done', 200, 't3'));
    await expect(chat(cfg, [{ role: 'user', content: 'where?' }])).resolves.toEqual({ content: 'done', thinking: 't3' });
    expect(fn).toHaveBeenCalledTimes(4);
    const asks = [1, 2, 3].map((i) => bodyOf(fn, i).messages.at(-1).content as string);
    expect(asks).toEqual([...CONTENT_RETRY_LADDER]);
    expect(new Set(asks).size).toBe(3);
    expect(asks[1]).toMatch(/short, direct answer/);
    expect(asks[2]).toMatch(/JSON object/);
  });

  it('asks a fallback rephrased question on its own after the ladder runs out', async () => {
    const msgs: ChatMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'old' }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'Is the dialog open?', images: ['QUJD'] }];
    const fn = stubFetch(reply('', 200, 'a'), reply('', 200, 'b'), reply('', 200, 'c'), reply('', 200, 'd'), reply('Yes, it is open.'));
    await expect(chat(cfg, msgs)).resolves.toEqual({ content: 'Yes, it is open.', thinking: 'd' });
    expect(fn).toHaveBeenCalledTimes(5);
    expect(bodyOf(fn, 4).messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: `${FALLBACK_QUESTION_PREFIX}Is the dialog open?`, images: ['QUJD'] },
    ]);
  });

  it('accepts the thinking as the answer when every try is thinking only', async () => {
    const fn = stubFetch(...['h1', 'h2', 'h3', 'h4', 'the button is top-left'].map((t) => reply('', 200, t)));
    await expect(chat(cfg, [{ role: 'user', content: 'q' }])).resolves.toEqual({ content: 'the button is top-left', thinking: 'the button is top-left', thinkingOnly: true });
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('accepts the latest thinking when a retry fails instead of blocking', async () => {
    stubFetch(reply('', 200, 'early idea'), new TypeError('Failed to fetch'));
    await expect(chat(cfg, [])).resolves.toEqual({ content: 'early idea', thinking: 'early idea', thinkingOnly: true });
  });

  it('still rejects a cancel that lands during the ladder', async () => {
    const ctrl = new AbortController();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(reply('', 200, 'thinking'))
      .mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        ctrl.abort();
      })));
    await expect(chat(cfg, [], false, 60_000, ctrl.signal)).rejects.toBeInstanceOf(AiCancelled);
  });

  it('rejects as cancelled when the cancel signal aborts the request', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const ctrl = new AbortController();
    const pending = chat(cfg, [], false, 60_000, ctrl.signal);
    ctrl.abort();
    await expect(pending).rejects.toThrow('AI request cancelled');
  });
});

describe('chat cancellation', () => {
  /** A fetch that only settles when its signal aborts (or after 10 s). */
  function hangingFetch() {
    const seen: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      seen.push(init.signal!);
      const t = setTimeout(() => resolve(reply('late')), 10_000);
      init.signal!.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      });
    })));
    return seen;
  }

  it('aborting the signal mid-call cancels the fetch and rejects at once with AiCancelled', async () => {
    const seen = hangingFetch();
    const ctrl = new AbortController();
    const started = Date.now();
    const call = chat(cfg, [], false, 90_000, ctrl.signal);
    setTimeout(() => ctrl.abort(), 50);
    await expect(call).rejects.toBeInstanceOf(AiCancelled);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(seen[0].aborted).toBe(true);
  });

  it('an already-aborted signal never waits for the endpoint', async () => {
    hangingFetch();
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(chat(cfg, [], false, 90_000, ctrl.signal)).rejects.toBeInstanceOf(AiCancelled);
  });

  it('still times out with an AiError (not a cancel) when nothing aborts', async () => {
    const seen = hangingFetch();
    const error = await chat(cfg, [], false, 30).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error).not.toBeInstanceOf(AiCancelled);
    expect(String(error)).toMatch(/no reply within 30 ms/);
    expect(seen[0].aborted).toBe(true);
  });

  it('a session ask times out after cfg.timeoutMs', async () => {
    const seen = hangingFetch();
    const error = await createAiSession(null).ask({ ...cfg, timeoutMs: 40 }, { system: 's', prompt: 'p' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error).not.toBeInstanceOf(AiCancelled);
    expect(String(error)).toMatch(/no reply within 40 ms/);
    expect(seen[0].aborted).toBe(true);
  });

  it('a session ask with the longest timeout is still cancelled at once by its signal and by cancel()', async () => {
    hangingFetch();
    const session = createAiSession(null);
    const ctrl = new AbortController();
    const started = Date.now();
    const bySignal = session.ask({ ...cfg, timeoutMs: AI_TIMEOUT_MS_MAX }, { system: 's', prompt: 'p', signal: ctrl.signal });
    const byCancel = session.ask({ ...cfg, timeoutMs: AI_TIMEOUT_MS_MAX }, { system: 's', prompt: 'p' });
    setTimeout(() => {
      ctrl.abort();
      session.cancel();
    }, 20);
    await expect(bySignal).rejects.toBeInstanceOf(AiCancelled);
    await expect(byCancel).rejects.toBeInstanceOf(AiCancelled);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('a session ask passes the request signal through', async () => {
    const seen = hangingFetch();
    const ctrl = new AbortController();
    const call = createAiSession(null).ask(cfg, { system: 's', prompt: 'p', signal: ctrl.signal });
    ctrl.abort();
    await expect(call).rejects.toBeInstanceOf(AiCancelled);
    expect(seen[0].aborted).toBe(true);
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

  it('takes the last JSON object after reasoning prose', () => {
    const raw = 'Thinking Process:\n1. The user asked {"maybe": "this"}.\n2. Final answer below.\n{"success": true, "pattern_add": "wait {briefly}"}';
    expect(parseJsonReply(raw)).toEqual({ success: true, pattern_add: 'wait {briefly}' });
  });

  it('returns the whole last object, not a nested one', () => {
    expect(parseJsonReply('plan: {"steps":[{"action":"click","x":1}]} done')).toEqual({ steps: [{ action: 'click', x: 1 }] });
  });

  it('skips a trailing brace group that is not JSON', () => {
    expect(parseJsonReply('ans {"a":1} (note {not json})')).toEqual({ a: 1 });
  });

  it('ignores JSON inside think blocks and stray think tags', () => {
    expect(parseJsonReply('<think>{"no":1}</think>Sure. {"yes":2}</think>')).toEqual({ yes: 2 });
  });

  it('throws an AiParseError with the raw reply truncated when there is no JSON object', () => {
    const prose = `Thinking Process: ${'the user wants me to decide. '.repeat(30)}`;
    let caught: unknown;
    try {
      parseJsonReply(prose);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AiParseError);
    expect(caught).toBeInstanceOf(AiError);
    const raw = (caught as AiParseError).raw;
    expect(raw.length).toBeLessThanOrEqual(RAW_REPLY_MAX + 1);
    expect(raw.startsWith('Thinking Process:')).toBe(true);
    expect((caught as Error).message).not.toContain('Thinking Process');
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
    const fn = stubFetch(reply('first', 200, 'secret reasoning'), reply('second'));
    const session = createAiSession(store);
    await expect(session.ask(cfg, { system: 'sys', prompt: 'look', frame, context: ['[You] clicked'] })).resolves.toEqual({ content: 'first', thinking: 'secret reasoning', view: { w: 480, h: 270 } });
    await session.ask(cfg, { system: 'sys', prompt: 'again' });
    const first = bodyOf(fn, 0).messages;
    expect(first[1]).toMatchObject({ role: 'user', images: ['QUJD'] });
    expect(first[1].content).toContain('[You] clicked');
    const second = bodyOf(fn, 1).messages.map((m: { role: string; content: string }) => [m.role, m.content]);
    expect(second.slice(2, 3)).toEqual([['assistant', 'first']]);
    expect(createAiSession(store).history()).toHaveLength(4);
    expect(JSON.stringify(createAiSession(store).history())).not.toContain('secret reasoning');
  });

  it('sends the operation memory with every turn but keeps it out of the history', async () => {
    const fn = stubFetch(reply('one'), reply('two'));
    const session = createAiSession(null);
    const memory = ['OPERATION MEMORY (applies to this whole operation):', 'BLACKLISTED — never repeat:', '- [learned avoid] double click the row'];
    await session.ask(cfg, { system: 's', prompt: 'plan', context: [], memory });
    await session.ask(cfg, { system: 's', prompt: 'next', memory });
    const sent = bodyOf(fn, 1).messages as Array<{ role: string; content: string }>;
    expect(sent.at(-1)!.content).toContain('BLACKLISTED — never repeat:\n- [learned avoid] double click the row');
    expect(sent[1].content).toBe('plan');
    expect(session.history().map((h) => h.content).join('\n')).not.toContain('BLACKLISTED');
  });

  it('does not record a failed turn', async () => {
    stubFetch(new TypeError('down'));
    const session = createAiSession(null);
    await expect(session.ask(cfg, { system: 's', prompt: 'p' })).rejects.toThrow(AiError);
    expect(session.history()).toHaveLength(0);
  });

  it('cancel() aborts the request in flight and later asks still work', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const session = createAiSession(null);
    const pending = session.ask(cfg, { system: 's', prompt: 'p' });
    session.cancel();
    await expect(pending).rejects.toThrow('AI request cancelled');
    stubFetch(reply('again'));
    await expect(session.ask(cfg, { system: 's', prompt: 'p' })).resolves.toMatchObject({ content: 'again' });
  });
});

describe('master prompt override', () => {
  it('leaves the system prompt alone when the directive is empty or blank', () => {
    expect(withMasterPrompt('sys')).toBe('sys');
    expect(withMasterPrompt('sys', '   ')).toBe('sys');
  });

  it('injects the trimmed directive into the system prompt of every session ask', async () => {
    const fn = stubFetch(reply('{"x":1}'), reply('ok'));
    const session = createAiSession(null);
    await session.ask({ ...cfg, masterPrompt: '  Prefer keyboard shortcuts; calm tone.  ' }, { system: (v) => `Planner for ${v.w}x${v.h}.`, prompt: 'plan', json: true });
    await session.ask({ ...cfg, masterPrompt: 'Be brief.' }, { system: 'Verdict judge.', prompt: 'judge' });
    const [plannerSys, verdictSys] = [0, 1].map((i) => bodyOf(fn, i).messages[0]);
    expect(plannerSys.role).toBe('system');
    expect(plannerSys.content).toMatch(/^Planner for 480x270\.[\s\S]*master directive[\s\S]*\nPrefer keyboard shortcuts; calm tone\.$/);
    expect(verdictSys.content).toMatch(/^Verdict judge\.[\s\S]*\nBe brief\.$/);
  });

  it('sends the bare system prompt when no directive is set', async () => {
    const fn = stubFetch(reply('ok'));
    await createAiSession(null).ask({ ...cfg, masterPrompt: '' }, { system: 'Grounding.', prompt: 'p' });
    expect(bodyOf(fn).messages[0]).toEqual({ role: 'system', content: 'Grounding.' });
  });
});

describe('thinkingOnlyNotice', () => {
  it('states what happened, carries the thinking and suggests a next step', () => {
    const text = thinkingOnlyNotice('Click the blue Save button');
    expect(text).toMatch(/only in its thinking/);
    expect(text).toContain('Click the blue Save button');
    expect(text).toMatch(/self-test|queue/);
  });
});
