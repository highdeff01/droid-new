import type { AskFn } from './ai.js';

export const LONG_GENERATION_MAX_ROUNDS = 12;
export const LONG_GENERATION_MAX_CHARS = 100_000;
export const LONG_GENERATION_CONTEXT_TAIL_CHARS = 2_400;
export const LONG_GENERATION_END_MARKER = '<!-- DROID_DONE -->';

export interface LongGenerationOptions {
  maxRounds?: number;
  maxChars?: number;
  contextTailChars?: number;
  signal?: AbortSignal;
  onProgress?: (event: { round: number; maxRounds: number; totalChars: number; detail: string }) => void;
}
export interface LongGenerationResult {
  content: string;
  rounds: number;
  complete: boolean;
  stoppedBecause: 'model_finished' | 'round_limit' | 'character_limit';
}

/** Remove a repeated prefix when a model restarts by echoing the previous ending. */
export function appendWithoutOverlap(existing: string, next: string, maxOverlap = 2_000): string {
  const limit = Math.min(existing.length, next.length, Math.max(0, maxOverlap));
  for (let size = limit; size >= 8; size--) {
    if (existing.slice(-size) === next.slice(0, size)) return existing + next.slice(size).trimStart();
  }
  return existing + (existing && next ? '\n' : '') + next.trimStart();
}

/**
 * Generate a long answer through bounded sequential calls. The current AI session is used
 * through AskFn, so its history/cancellation path remains authoritative. This is chunked
 * generation, not token streaming: each call completes before the next starts.
 */
export async function generateLongResponse(
  ask: AskFn,
  question: string,
  options: LongGenerationOptions = {},
): Promise<LongGenerationResult> {
  const maxRounds = Math.max(1, Math.min(50, Math.floor(options.maxRounds ?? LONG_GENERATION_MAX_ROUNDS)));
  const maxChars = Math.max(1_000, Math.min(500_000, Math.floor(options.maxChars ?? LONG_GENERATION_MAX_CHARS)));
  const tailChars = Math.max(200, Math.min(8_000, Math.floor(options.contextTailChars ?? LONG_GENERATION_CONTEXT_TAIL_CHARS)));
  let content = '';
  for (let round = 1; round <= maxRounds; round++) {
    if (options.signal?.aborted) throw new Error('Long generation cancelled.');
    const continuation = content.length > 0;
    const prompt = continuation
      ? [
          'Continue the answer below. Do not repeat, summarize, or restart it.',
          'Continue exactly where the text ends, preserve its structure and code fences, and add the next useful section.',
          'If the entire requested answer is now complete, finish with the exact marker ' + LONG_GENERATION_END_MARKER + '.',
          'If more content is still required, do not emit that marker.',
          'PREVIOUS ANSWER ENDING (context only):',
          content.slice(-tailChars),
          'Continue now.'
        ].join('\n\n')
      : [
          question,
          'Produce a thorough, complete answer. If it cannot fit in one response, stop at a clean boundary and allow the continuation process to request the next section.',
          'When the entire requested answer is complete, finish with the exact marker ' + LONG_GENERATION_END_MARKER + '.'
        ].join('\n\n');
    options.onProgress?.({ round, maxRounds, totalChars: content.length, detail: continuation ? 'Generating continuation ' + round : 'Generating initial section' });
    const reply = await ask({
      system: 'Long-form answer generator. Follow the user request. Maintain one coherent document across continuation calls. Never fabricate completion; use the required completion marker only when the requested work is genuinely complete.',
      prompt,
      signal: options.signal,
    });
    let part = reply.content.trim();
    if (!part) throw new Error('Long generation stopped: the model returned an empty content section.');
    const finished = part.includes(LONG_GENERATION_END_MARKER);
    part = part.replaceAll(LONG_GENERATION_END_MARKER, '').trimEnd();
    content = appendWithoutOverlap(content, part, tailChars);
    if (content.length > maxChars) {
      content = content.slice(0, maxChars);
      return { content, rounds: round, complete: false, stoppedBecause: 'character_limit' };
    }
    if (finished) return { content, rounds: round, complete: true, stoppedBecause: 'model_finished' };
  }
  return { content, rounds: maxRounds, complete: false, stoppedBecause: 'round_limit' };
}
