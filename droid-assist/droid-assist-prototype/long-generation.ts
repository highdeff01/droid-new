import type { AskFn } from './ai.js';

export const LONG_GENERATION_MAX_ROUNDS = 12;
export const LONG_GENERATION_MAX_CHARS = 100_000;
export const LONG_GENERATION_CONTEXT_TAIL_CHARS = 2_400;
export const LONG_GENERATION_END_MARKER = '<!-- DROID_DONE -->';

export type LongGenerationStopReason = 'model_finished' | 'round_limit' | 'character_limit' | 'cancelled' | 'model_error';
export type LongGenerationMode = 'answer' | 'multi_file_code';

export interface LongGenerationOptions {
  maxRounds?: number;
  maxChars?: number;
  contextTailChars?: number;
  signal?: AbortSignal;
  mode?: LongGenerationMode;
  onProgress?: (event: { round: number; maxRounds: number; totalChars: number; detail: string }) => void;
  /** Receives a durable snapshot after every completed model call. */
  onPartial?: (content: string, round: number) => void;
}
export interface LongGenerationResult {
  content: string;
  rounds: number;
  complete: boolean;
  stoppedBecause: 'model_finished' | 'round_limit' | 'character_limit';
}
export class LongGenerationError extends Error {
  readonly partial: LongGenerationResult;
  constructor(message: string, partial: LongGenerationResult) {
    super(message);
    this.name = 'LongGenerationError';
    this.partial = partial;
  }
}

/** Remove a repeated prefix when a model restarts by echoing the previous ending. */
export function appendWithoutOverlap(existing: string, next: string, maxOverlap = 2_000): string {
  const limit = Math.min(existing.length, next.length, Math.max(0, maxOverlap));
  for (let size = limit; size >= 8; size--) {
    if (existing.slice(-size) === next.slice(0, size)) return existing + next.slice(size);
  }
  return existing + (existing && next ? '\n' : '') + next.trimStart();
}

/** Collect explicit FILE: path declarations without assuming arbitrary headings are filenames. */
export function extractGeneratedFilePaths(content: string): string[] {
  const found = new Set<string>();
  const pattern = /^\s*(?:FILE|File)\s*:\s*(.+?)\s*$/gm;
  for (const match of content.matchAll(pattern)) {
    const value = match[1]?.trim();
    if (value && value.length <= 240 && !/[<>]/.test(value)) found.add(value);
  }
  return [...found];
}

/**
 * Bounded multi-call generation. Each successful section is checkpointed immediately so a
 * later model failure or cancellation cannot erase already generated work.
 */
export async function generateLongResponse(
  ask: AskFn,
  question: string,
  options: LongGenerationOptions = {},
): Promise<LongGenerationResult> {
  const maxRounds = Math.max(1, Math.min(50, Math.floor(options.maxRounds ?? LONG_GENERATION_MAX_ROUNDS)));
  const maxChars = Math.max(1_000, Math.min(500_000, Math.floor(options.maxChars ?? LONG_GENERATION_MAX_CHARS)));
  const tailChars = Math.max(200, Math.min(8_000, Math.floor(options.contextTailChars ?? LONG_GENERATION_CONTEXT_TAIL_CHARS)));
  const mode = options.mode ?? 'answer';
  let content = '';
  let rounds = 0;
  const snapshot = (complete: boolean, stoppedBecause: LongGenerationResult['stoppedBecause']): LongGenerationResult => ({
    content, rounds, complete, stoppedBecause,
  });
  for (let round = 1; round <= maxRounds; round++) {
    if (options.signal?.aborted) {
      throw new LongGenerationError('Long generation cancelled.', snapshot(false, 'round_limit'));
    }
    const continuation = content.length > 0;
    const paths = extractGeneratedFilePaths(content);
    const fileInstructions = mode === 'multi_file_code'
      ? [
          'MULTI-FILE OUTPUT MODE: emit each file as a separate section using exactly this header format: FILE: relative/path.ext',
          'Put the complete contents of that file in a fenced code block. Never invent absolute paths.',
          'Do not repeat a file already listed as completed. Continue with the next missing file.',
          'Keep imports and exported names consistent across files. Do not claim a file is complete if its code is truncated.',
          'Files already started/completed: ' + (paths.length ? paths.join(', ') : '(none yet)'),
        ].join('\n')
      : '';
    const prompt = continuation
      ? [
          'Continue the answer below. Do not repeat, summarize, or restart it.',
          'Continue exactly where the text ends, preserve its structure and code fences, and add the next useful section.',
          fileInstructions,
          'If the entire requested answer is now complete, finish with the exact marker ' + LONG_GENERATION_END_MARKER + '.',
          'If more content is still required, do not emit that marker.',
          'PREVIOUS ANSWER ENDING (context only):',
          content.slice(-tailChars),
          'Continue now.',
        ].filter(Boolean).join('\n\n')
      : [
          question,
          fileInstructions,
          'Produce a thorough, complete answer. If it cannot fit in one response, stop at a clean boundary and allow the continuation process to request the next section.',
          'When the entire requested answer is complete, finish with the exact marker ' + LONG_GENERATION_END_MARKER + '.',
        ].filter(Boolean).join('\n\n');
    options.onProgress?.({ round, maxRounds, totalChars: content.length, detail: continuation ? 'Generating continuation ' + round : 'Generating initial section' });
    let reply: Awaited<ReturnType<AskFn>>;
    try {
      reply = await ask({
        system: mode === 'multi_file_code'
          ? 'Long-form software generator. Produce a coherent multi-file project. Follow FILE path headers exactly, preserve prior decisions, and never claim completion while files remain.'
          : 'Long-form answer generator. Follow the user request. Maintain one coherent document across continuation calls. Never fabricate completion.',
        prompt,
        signal: options.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LongGenerationError(message, snapshot(false, options.signal?.aborted ? 'round_limit' : 'round_limit'));
    }
    let part = reply.content.trim();
    if (!part) throw new LongGenerationError('Long generation stopped: the model returned an empty content section.', snapshot(false, 'round_limit'));
    const finished = part.includes(LONG_GENERATION_END_MARKER);
    part = part.replaceAll(LONG_GENERATION_END_MARKER, '').trimEnd();
    content = appendWithoutOverlap(content, part, tailChars);
    rounds = round;
    options.onPartial?.(content, round);
    if (content.length > maxChars) {
      content = content.slice(0, maxChars);
      const result = snapshot(false, 'character_limit');
      options.onPartial?.(content, round);
      return result;
    }
    if (finished) return snapshot(true, 'model_finished');
  }
  return snapshot(false, 'round_limit');
}
