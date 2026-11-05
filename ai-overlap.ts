import type { AiReply } from './ai.js';

/** One contender of an overlapped ask: starts its model call and stops it when `signal` aborts. */
export type OverlapCall = (signal: AbortSignal) => Promise<AiReply>;

/** Prefixed to the prompt of the second, overlapping call so it is asked afresh. */
export const OVERLAP_PREFIX = 'Answer directly in the message content, briefly. Question: ';

/**
 * Runs every call at once; the first reply with real content (not thinking only) wins and the
 * others are aborted. When no call gives real content, the earliest-started thinking-only reply
 * wins; when every call fails, it rejects with the first call's error.
 */
export function firstValid(calls: OverlapCall[]): Promise<AiReply> {
  const ctrls = calls.map(() => new AbortController());
  const settled: Array<{ reply?: AiReply; error?: unknown } | undefined> = calls.map(() => undefined);
  return new Promise<AiReply>((resolve, reject) => {
    const finish = () => {
      if (settled.some((s) => !s)) return;
      const fallback = settled.find((s) => s?.reply)?.reply;
      if (fallback) resolve(fallback);
      else reject(settled[0]?.error);
    };
    calls.forEach((call, i) => {
      call(ctrls[i].signal).then(
        (reply) => {
          settled[i] = { reply };
          if (reply.thinkingOnly) return finish();
          ctrls.forEach((c, j) => j !== i && c.abort());
          resolve(reply);
        },
        (error: unknown) => {
          settled[i] = { error };
          finish();
        },
      );
    });
  });
}
