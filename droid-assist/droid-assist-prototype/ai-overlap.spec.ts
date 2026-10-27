import { describe, expect, it } from 'vitest';
import { firstValid, type OverlapCall } from './ai-overlap.js';
import type { AiReply } from './ai.js';

/** A call that settles with `result` after `ms`, recording whether its signal was aborted. */
function delayed(result: AiReply | Error, ms: number) {
  const seen = { aborted: false };
  const call: OverlapCall = (signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => {
      seen.aborted = true;
      reject(new Error('aborted'));
    });
    setTimeout(() => (result instanceof Error ? reject(result) : resolve(result)), ms);
  });
  return { call, seen };
}

describe('firstValid', () => {
  it('takes the first reply with real content and cancels the loser', async () => {
    const slow = delayed({ content: 'slow', thinking: null }, 40);
    const fast = delayed({ content: 'fast', thinking: 'quick' }, 5);
    await expect(firstValid([slow.call, fast.call])).resolves.toEqual({ content: 'fast', thinking: 'quick' });
    expect(slow.seen.aborted).toBe(true);
    expect(fast.seen.aborted).toBe(false);
  });

  it('waits past a thinking-only reply for a real answer', async () => {
    const thinker = delayed({ content: 'hmm', thinking: 'hmm', thinkingOnly: true }, 5);
    const answer = delayed({ content: 'Top bar', thinking: null }, 20);
    await expect(firstValid([thinker.call, answer.call])).resolves.toEqual({ content: 'Top bar', thinking: null });
  });

  it('falls back to a thinking-only reply when the other call fails', async () => {
    const thinker = delayed({ content: 'idea', thinking: 'idea', thinkingOnly: true }, 20);
    const broken = delayed(new Error('HTTP 500'), 5);
    await expect(firstValid([broken.call, thinker.call])).resolves.toMatchObject({ content: 'idea', thinkingOnly: true });
  });

  it('rejects with the first call error when every call fails', async () => {
    await expect(firstValid([delayed(new Error('first'), 10).call, delayed(new Error('second'), 5).call])).rejects.toThrow('first');
  });
});
