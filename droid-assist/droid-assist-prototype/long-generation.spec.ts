import { describe, expect, it, vi } from 'vitest';
import type { AskFn } from './ai.js';
import { appendWithoutOverlap, extractGeneratedFilePaths, generateLongResponse, LongGenerationError, LONG_GENERATION_END_MARKER } from './long-generation.js';

describe('long-form generation', () => {
  it('appends continuations without duplicating an echoed overlap', () => {
    expect(appendWithoutOverlap('A'.repeat(80) + 'shared ending', 'shared ending' + ' next section')).toBe('A'.repeat(80) + 'shared ending next section');
  });

  it('requests sequential continuation calls until the model marks completion', async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce({ content: 'Section one. More follows.', thinking: null })
      .mockResolvedValueOnce({ content: 'More follows. Section two is complete. ' + LONG_GENERATION_END_MARKER, thinking: null });
    const result = await generateLongResponse(ask as unknown as AskFn, 'Write a detailed technical guide.');
    expect(ask).toHaveBeenCalledTimes(2);
    expect(result.complete).toBe(true);
    expect(result.rounds).toBe(2);
    expect(result.content).toContain('Section one.');
    expect(result.content).toContain('Section two is complete.');
    expect(result.content.match(/More follows\./g)).toHaveLength(1);
  });

  it('reports when the configured round limit is reached', async () => {
    const ask = vi.fn().mockResolvedValue({ content: 'Still continuing.', thinking: null });
    const result = await generateLongResponse(ask as unknown as AskFn, 'Write a long book.', { maxRounds: 2 });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(result.complete).toBe(false);
    expect(result.stoppedBecause).toBe('round_limit');
  });

  it('stops cleanly at the character budget', async () => {
    const ask = vi.fn().mockResolvedValue({ content: 'x'.repeat(2_000), thinking: null });
    const result = await generateLongResponse(ask as unknown as AskFn, 'Write more.', { maxChars: 1_000 });
    expect(result.complete).toBe(false);
    expect(result.stoppedBecause).toBe('character_limit');
    expect(result.content).toHaveLength(1_000);
  });

  it('honors cancellation before starting another model call', async () => {
    const controller = new AbortController();
    controller.abort();
    const ask = vi.fn();
    await expect(generateLongResponse(ask as unknown as AskFn, 'Write.', { signal: controller.signal })).rejects.toThrow('cancelled');
    expect(ask).not.toHaveBeenCalled();
  });

  it('checkpoints completed sections and preserves them when a later call fails', async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce({ content: 'First durable section.', thinking: null })
      .mockRejectedValueOnce(new Error('endpoint unavailable'));
    const checkpoints: string[] = [];
    try {
      await generateLongResponse(ask as unknown as AskFn, 'Write a long response.', {
        onPartial: (content) => checkpoints.push(content),
      });
      throw new Error('Expected generation to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(LongGenerationError);
      expect((error as LongGenerationError).partial.content).toContain('First durable section.');
      expect((error as LongGenerationError).partial.stoppedBecause).toBe('model_error');
      expect(checkpoints).toHaveLength(1);
    }
  });

  it('requests stable FILE headers and carries the generated file manifest into continuation prompts', async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce({ content: 'FILE: src/main.ts\n```ts\nexport const main = true;\n```', thinking: null })
      .mockResolvedValueOnce({ content: 'FILE: src/utils.ts\n```ts\nexport const util = true;\n``` ' + LONG_GENERATION_END_MARKER, thinking: null });
    const result = await generateLongResponse(ask as unknown as AskFn, 'Build a two-file TypeScript project.', { mode: 'multi_file_code' });
    expect(result.complete).toBe(true);
    expect(ask.mock.calls[0][0].prompt).toContain('FILE: relative/path.ext');
    expect(ask.mock.calls[1][0].prompt).toContain('src/main.ts');
    expect(extractGeneratedFilePaths(result.content)).toEqual(['src/main.ts', 'src/utils.ts']);
  });

  it('extracts only explicit, bounded file path headers', () => {
    expect(extractGeneratedFilePaths('FILE: src/a.ts\nFile: src/b.ts\nFILE: <script>\nFILE: ' + 'x'.repeat(300))).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
