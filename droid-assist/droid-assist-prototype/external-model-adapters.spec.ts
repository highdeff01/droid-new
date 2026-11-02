import { describe, expect, it, vi } from 'vitest';
import { createExternalModelBridge } from './external-model-adapters.js';

describe('external model adapters', () => {
  it('sends Ollama-compatible chat requests and returns model content', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify({ message: { content: 'Friday.' } }), { status: 200 }));
    const bridge = createExternalModelBridge({ id: 'ollama-test', label: 'Ollama test', endpoint: 'http://localhost:11434/api/chat', model: 'qwen3.5:2b', protocol: 'ollama' }, fetcher as typeof fetch);
    const result = await bridge.ask({ system: 'Be grounded.', prompt: 'When is the release?' });
    expect(result.content).toBe('Friday.');
    expect(fetcher).toHaveBeenCalledOnce();
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'qwen3.5:2b', stream: false });
  });

  it('sends bearer auth and parses OpenAI-compatible choices', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Evidence-backed answer.' } }] }), { status: 200 }));
    const bridge = createExternalModelBridge({ id: 'openai-test', label: 'Compatible API', endpoint: 'https://example.test/v1/chat/completions', model: 'model-x', protocol: 'openai-compatible', apiKey: 'secret-test' }, fetcher as typeof fetch);
    expect((await bridge.ask({ system: 'Review.', prompt: 'Check this.' })).content).toBe('Evidence-backed answer.');
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-test');
  });

  it('rejects invalid endpoints and surfaces HTTP errors', async () => {
    expect(() => createExternalModelBridge({ id: 'bad', label: 'Bad', endpoint: 'not-a-url', model: 'x', protocol: 'ollama' })).toThrow(/absolute HTTP/);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));
    const bridge = createExternalModelBridge({ id: 'denied', label: 'Denied', endpoint: 'https://example.test/api/chat', model: 'x', protocol: 'ollama' }, fetcher as typeof fetch);
    await expect(bridge.ask({ system: 's', prompt: 'p' })).rejects.toThrow(/HTTP 401/);
  });
});
