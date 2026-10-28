import { describe, expect, it, vi } from 'vitest';
import {
  NO_BACKOFF, REPEAT_LIMIT_BACKOFF_MS, backoffDelay, backoffStatus, backoffText, clearBackoff, noteRepeatLimit, repeatLimitLine, type AiBackoff,
} from './ai-backoff.js';
import { AiError, AiHttpError, REPEAT_LIMIT_REPHRASE, chat, isRepeatLimit, rephraseForRepeatLimit, type ChatMessage } from './ai.js';

/** A fetch Response-like reply for the given status and JSON body. */
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

describe('repeat-limit backoff', () => {
  it('the backoff ladder is fixed', () => {
    expect(REPEAT_LIMIT_BACKOFF_MS).toEqual([15000, 30000, 60000, 120000, 300000]);
  });

  it.each([
    [1, 15000],
    [2, 30000],
    [5, 300000],
    [9, 300000],
  ])('backoffDelay(%i) is %ims', (streak, ms) => {
    expect(backoffDelay(streak)).toBe(ms);
  });

  it('noteRepeatLimit grows the streak and total and sets until from the delay', () => {
    const first = noteRepeatLimit(NO_BACKOFF, 1000);
    expect(first).toEqual({ streak: 1, total: 1, until: 16000 });
    const second = noteRepeatLimit(first, 2000);
    expect(second).toEqual({ streak: 2, total: 2, until: 32000 });
  });

  it('clearBackoff keeps the total but zeroes the streak and the wait', () => {
    const b: AiBackoff = { streak: 3, total: 5, until: 99999 };
    expect(clearBackoff(b)).toEqual({ streak: 0, total: 5, until: 0 });
  });

  it('backoffText reports whole seconds left', () => {
    const now = Date.now();
    expect(backoffText({ streak: 1, total: 1, until: now + 15000 }, now)).toBe('endpoint erroring — retrying in 15s');
  });

  it('backoffStatus is the AI status badge while backing off', () => {
    const now = Date.now();
    const b: AiBackoff = { streak: 2, total: 4, until: now + 30000 };
    const status = backoffStatus(b, now);
    expect(status.state).toBe('backoff');
    expect(status.detail.startsWith('endpoint erroring — retrying in')).toBe(true);
  });

  it('repeatLimitLine counts the failure distinctly in the log', () => {
    const now = Date.now();
    const b: AiBackoff = { streak: 1, total: 7, until: now + 15000 };
    expect(repeatLimitLine(b, now)).toContain('Repeat-limit 500 #7');
  });

  describe('isRepeatLimit', () => {
    it('true for the repeat-limit 500', () => {
      expect(isRepeatLimit(new AiHttpError(500, 'prediction aborted, token repeat limit reached'))).toBe(true);
    });

    it('false for another 500 detail', () => {
      expect(isRepeatLimit(new AiHttpError(500, 'out of memory'))).toBe(false);
    });

    it('false for a repeat-limit detail on a non-500 status', () => {
      expect(isRepeatLimit(new AiHttpError(502, 'token repeat limit reached'))).toBe(false);
    });

    it('false for a plain AiError', () => {
      expect(isRepeatLimit(new AiError('x'))).toBe(false);
    });
  });

  it('AiHttpError.message carries the status and detail', () => {
    expect(new AiHttpError(500, 'boom').message).toBe('AI endpoint HTTP 500: boom');
  });

  describe('rephraseForRepeatLimit', () => {
    it('prefixes the rephrase instruction to an existing system message', () => {
      const messages: ChatMessage[] = [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }];
      const out = rephraseForRepeatLimit(messages);
      expect(out[0].content.startsWith(REPEAT_LIMIT_REPHRASE)).toBe(true);
      expect(out[1]).toEqual(messages[1]);
    });

    it('prepends a system message when none exists', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'U' }];
      const out = rephraseForRepeatLimit(messages);
      expect(out[0]).toEqual({ role: 'system', content: REPEAT_LIMIT_REPHRASE });
    });
  });

  describe('chat retries once on a repeat-limit 500 then backs off', () => {
    const cfg = { url: 'http://x/api/chat', model: 'm' };
    const messages: ChatMessage[] = [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }];

    it('a repeat-limit 500 then a good reply resolves with the rephrased retry', async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(reply(500, { error: 'prediction aborted, token repeat limit reached' }))
        .mockResolvedValueOnce(reply(200, { message: { content: 'hi' } }));
      vi.stubGlobal('fetch', fetch);
      const result = await chat(cfg, messages);
      expect(result.content).toBe('hi');
      expect(fetch).toHaveBeenCalledTimes(2);
      const secondBody = JSON.parse(fetch.mock.calls[1][1].body);
      expect(secondBody.messages[0].content.startsWith(REPEAT_LIMIT_REPHRASE)).toBe(true);
    });

    it('two repeat-limit 500s in a row rejects after exactly two calls', async () => {
      const fetch = vi.fn()
        .mockResolvedValueOnce(reply(500, { error: 'prediction aborted, token repeat limit reached' }))
        .mockResolvedValueOnce(reply(500, { error: 'prediction aborted, token repeat limit reached' }));
      vi.stubGlobal('fetch', fetch);
      await expect(chat(cfg, messages)).rejects.toSatisfy((error: unknown) => isRepeatLimit(error));
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('a non-repeat-limit 500 rejects after exactly one call', async () => {
      const fetch = vi.fn().mockResolvedValueOnce(reply(500, { error: 'boom' }));
      vi.stubGlobal('fetch', fetch);
      await expect(chat(cfg, messages)).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});
