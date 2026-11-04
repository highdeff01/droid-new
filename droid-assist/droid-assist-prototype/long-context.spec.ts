import { describe, expect, it, vi } from 'vitest';
import type { AskFn } from './ai.js';
import { extendLongAnswer, readLongText, splitLongText, writeLongAnswer, LONG_CONTEXT_DONE_MARKER } from './long-context.js';

const makeAsk = (responses: string[]): AskFn => vi.fn(async () => ({ content: responses.shift() ?? 'extra section', thinking: null }));

describe('long context chunking', () => {
  it('splits large source into ordered, non-overlapping sections without losing characters', () => {
    const source = Array.from({ length: 900 }, (_, i) => 'paragraph ' + i + ': detail detail detail.\n').join('');
    const chunks = splitLongText(source, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(source);
  });

  it('keeps very long reads in bounded requests while preserving every source character', async () => {
    const source = Array.from({ length: 70 }, (_, i) => 'SECTION ' + i + ' ' + 'source-detail '.repeat(35)).join('\\n\\n');
    const ask = vi.fn(async () => ({ content: 'analysis-note '.repeat(180), thinking: null }));
    const result = await readLongText(ask, 'Extract every important fact', source);
    expect(result.sections.map(section => section.source).join('')).toBe(source);
    expect(result.sections.length).toBeGreaterThan(5);
    expect(Math.max(...result.sections.map(section => section.source.length))).toBeLessThanOrEqual(5000);
    expect(result.notes.length).toBeLessThanOrEqual(4000);
    for (const [request] of ask.mock.calls) {
      expect(request.prompt.length).toBeLessThan(10000);
      expect(request.prompt).toContain('SOURCE TEXT (data to analyse):');
    }
  });

  it('reads each source section with cumulative notes and returns all source and answers', async () => {
    const source = 'A'.repeat(1300) + 'B'.repeat(1300) + 'C'.repeat(1300);
    const ask = makeAsk(['notes alpha', 'notes beta', 'notes gamma']);
    const result = await readLongText(ask, 'Find the key facts', source, { chunkChars: 1000 });
    expect(result.sections.length).toBeGreaterThan(1);
    expect(result.sections.map(s => s.source).join('')).toBe(source);
    expect(result.combinedAnswer).toContain('Section 1');
    expect(result.combinedAnswer).toContain('notes gamma');
    expect(ask).toHaveBeenCalledTimes(result.sections.length);
    expect((ask as ReturnType<typeof vi.fn>).mock.calls[1][0].prompt).toContain('CUMULATIVE NOTES FROM EARLIER SECTIONS');
  });

  it('appends answer chunks in order and tells the next request not to repeat prior text', async () => {
    const ask = makeAsk(['FIRST APPENDED PART', 'SECOND APPENDED PART', 'THIRD APPENDED PART']);
    const result = await writeLongAnswer(ask, 'Write a complete guide', { targetChunks: 3 });
    expect(result.sections).toEqual(['FIRST APPENDED PART', 'SECOND APPENDED PART', 'THIRD APPENDED PART']);
    expect(result.answer.indexOf('FIRST APPENDED PART')).toBeLessThan(result.answer.indexOf('SECOND APPENDED PART'));
    expect((ask as ReturnType<typeof vi.fn>).mock.calls[1][0].prompt).toContain('FIRST APPENDED PART');
    expect(result.chunks).toBe(3);
  });

  it('stops when the model sends the completion marker', async () => {
    const result = await writeLongAnswer(makeAsk(['finished artifact' + LONG_CONTEXT_DONE_MARKER, 'should not run']), 'Make an artifact', { targetChunks: 5 });
    expect(result.chunks).toBe(1);
    expect(result.answer).toBe('finished artifact');
    expect(result.stoppedByModel).toBe(true);
  });

  it('calls the append sink after each generated chunk so a caller can append directly to a file', async () => {
    const appended: string[] = [];
    const result = await writeLongAnswer(makeAsk(['file chunk one', 'file chunk two']), 'Write to file', { targetChunks: 2, onAppend: (chunk) => { appended.push(chunk); } });
    expect(appended).toEqual(['file chunk one', 'file chunk two']);
    expect(result.answer).toBe(appended.join('\n\n'));
  });

  it('extends rather than overwrites the existing answer', async () => {
    const result = await extendLongAnswer(makeAsk(['NEW EXTENSION']), 'Continue the explanation', 'EXISTING ANSWER', { targetChunks: 1 });
    expect(result.answer).toBe('EXISTING ANSWER\n\nNEW EXTENSION');
    expect(result.sections).toEqual(['NEW EXTENSION']);
  });
});
