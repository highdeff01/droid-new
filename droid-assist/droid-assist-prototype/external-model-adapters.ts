import type { AskFn } from './ai.js';
import type { ModelBridge } from './document-pipeline.js';

export type ExternalChatProtocol = 'ollama' | 'openai-compatible';

export interface ExternalModelConfig {
  id: string;
  label: string;
  endpoint: string;
  model: string;
  protocol: ExternalChatProtocol;
  apiKey?: string;
  timeoutMs?: number;
}

/** Creates a real HTTP-backed reviewer adapter. Secrets remain in caller memory and are never persisted here. */
export function createExternalModelBridge(config: ExternalModelConfig, fetcher: typeof fetch = fetch): ModelBridge {
  const endpoint = config.endpoint.trim();
  const model = config.model.trim();
  if (!endpoint || !model) throw new Error('External model endpoint and model are required.');
  let parsed: URL;
  try { parsed = new URL(endpoint); } catch { throw new Error('External model endpoint must be an absolute HTTP(S) URL.'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('External model endpoint must use HTTP or HTTPS.');
  const ask: AskFn = async (request) => {
    const controller = new AbortController();
    const timeout = Math.max(1000, Math.min(300000, Math.floor(config.timeoutMs ?? 90000)));
    const timer = setTimeout(() => controller.abort(new Error('External model request timed out.')), timeout);
    const onAbort = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      if (request.signal?.aborted) throw new Error('External model request cancelled.');
      const system = typeof request.system === 'string' ? request.system : String(request.system ?? '');
      const messages = [
        { role: 'system', content: system },
        { role: 'user', content: [request.prompt, request.context?.length ? 'APP CONTEXT:\n' + request.context.join('\n').slice(0, 12000) : ''].filter(Boolean).join('\n\n') },
      ];
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.apiKey?.trim()) headers.Authorization = 'Bearer ' + config.apiKey.trim();
      const body = config.protocol === 'ollama'
        ? { model, messages, stream: false, ...(request.json ? { format: 'json' } : {}) }
        : { model, messages, stream: false, ...(request.json ? { response_format: { type: 'json_object' } } : {}) };
      const response = await fetcher(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok) {
        const detail = typeof payload?.error === 'string' ? payload.error : JSON.stringify(payload?.error ?? payload ?? {});
        throw new Error('External model HTTP ' + response.status + (detail && detail !== '{}' ? ': ' + detail.slice(0, 500) : ''));
      }
      let value: unknown;
      if (config.protocol === 'ollama') {
        const message = payload?.message as Record<string, unknown> | undefined;
        value = message?.content;
      } else {
        const choices = payload?.choices as Array<Record<string, unknown>> | undefined;
        const message = choices?.[0]?.message as Record<string, unknown> | undefined;
        value = message?.content;
      }
      if (typeof value !== 'string' || !value.trim()) throw new Error('External model returned no text content.');
      return { content: value.trim(), thinking: null };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
    }
  };
  return { id: config.id, label: config.label, ask };
}
