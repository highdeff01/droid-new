// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { PROXY_TIMEOUT_MS, createAiProxy, isPing, proxyOptionsFromEnv, type AiProxyOptions } from './ai-proxy.js';
import { DEFAULT_AI_URL, LOCAL_AI_PROXY_URL, PING_MESSAGE, chat, endpointHost, pingAi } from './ai.js';

let server: Server | null = null;
const realFetch = globalThis.fetch;

/** Starts the proxy on a free port with `upstreamFetch` standing in for the model endpoint; returns its chat URL. */
async function start(upstreamFetch: AiProxyOptions['fetchFn'], timeoutMs = 1000): Promise<string> {
  const app = createAiProxy({ upstream: 'http://upstream.test/api/chat', timeoutMs, fetchFn: upstreamFetch });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}${LOCAL_AI_PROXY_URL}`;
}

const postJson = (url: string, body: unknown) => realFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ollama = (content: string) => new Response(JSON.stringify({ message: { role: 'assistant', content, thinking: 'hm' } }), { status: 200 });

afterEach(async () => {
  await new Promise((r) => (server ? server.close(r) : r(null)));
  server = null;
});

describe('isPing', () => {
  it('is only the single user health-check message', () => {
    expect(isPing({ messages: [{ role: 'user', content: PING_MESSAGE }] })).toBe(true);
    expect(isPing({ messages: [{ role: 'system', content: PING_MESSAGE }] })).toBe(false);
    expect(isPing({ messages: [{ role: 'system', content: 's' }, { role: 'user', content: PING_MESSAGE }] })).toBe(false);
    expect(isPing({ messages: [{ role: 'user', content: 'Reply with OK' }] })).toBe(false);
    expect(isPing(null)).toBe(false);
  });
});

describe('createAiProxy', () => {
  it('answers the ping without calling the model, with CORS headers', async () => {
    const upstream = vi.fn<typeof fetch>();
    const url = await start(upstream);
    const res = await postJson(url, { model: 'qwen3.5:2b', messages: [{ role: 'user', content: PING_MESSAGE }], stream: false, think: false });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toEqual({ message: { role: 'assistant', content: 'OK', thinking: null } });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('answers a CORS preflight', async () => {
    const url = await start(vi.fn<typeof fetch>());
    const res = await realFetch(url, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toContain('Content-Type');
  });

  it('forwards the Ollama body unchanged and returns the reply unchanged', async () => {
    const upstream = vi.fn<typeof fetch>(async () => ollama('{"x":0.4}'));
    const url = await start(upstream);
    const body = { model: 'qwen3.5:7b', messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'where?', images: ['QUJD'] }], stream: false, think: true, format: 'json' };
    const res = await postJson(url, body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: { role: 'assistant', content: '{"x":0.4}', thinking: 'hm' } });
    const [target, init] = upstream.mock.calls[0];
    expect(target).toBe('http://upstream.test/api/chat');
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });

  it('passes an upstream HTTP error through with its status and body', async () => {
    const url = await start(async () => new Response(JSON.stringify({ error: 'model "nope" not found' }), { status: 404 }));
    const res = await postJson(url, { model: 'nope', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'model "nope" not found' });
  });

  it('answers 502 when the upstream is unreachable', async () => {
    const url = await start(async () => { throw new TypeError('fetch failed'); });
    const res = await postJson(url, { model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/unreachable: fetch failed/);
  });

  it('answers 504 when the upstream exceeds the timeout', async () => {
    const hang: typeof fetch = (_u, init) => new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const url = await start(hang, 50);
    const res = await postJson(url, { model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(504);
    expect((await res.json()).error).toMatch(/timed out/);
  });

  it('works from the app: pingAi and chat() through the proxy', async () => {
    const url = await start(async () => ollama('hello'));
    expect((await pingAi({ url, model: 'qwen3.5:2b' })).state).toBe('online');
    expect((await chat({ url, model: 'qwen3.5:2b' }, [{ role: 'user', content: 'hi' }])).content).toBe('hello');
  });
});

describe('proxy configuration', () => {
  it('uses a 60 s timeout and the quantumclaw endpoint unless DROID_AI_UPSTREAM is set', () => {
    expect(PROXY_TIMEOUT_MS).toBe(60_000);
    expect(proxyOptionsFromEnv({}).upstream).toBe(DEFAULT_AI_URL);
    expect(proxyOptionsFromEnv({ DROID_AI_UPSTREAM: 'http://lan:11434/api/chat' }).upstream).toBe('http://lan:11434/api/chat');
  });

  it('names the host of a relative proxy URL instead of throwing', () => {
    expect(endpointHost('https://quantumclaw.net/ollama/api/chat')).toBe('quantumclaw.net');
    expect(endpointHost(LOCAL_AI_PROXY_URL)).toBe('localhost');
  });
});
