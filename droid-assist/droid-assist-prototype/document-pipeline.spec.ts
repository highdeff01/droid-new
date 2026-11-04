import { describe, expect, it, vi } from 'vitest';
import type { AskFn } from './ai.js';
import { combineDocumentMaterial, DOCUMENT_COMBINE_BATCH_CHARS, planDocument, processDocument, splitDocumentEvenly } from './document-pipeline.js';

describe('adaptive document pipeline planning', () => {
  it('splits source without losing, duplicating, or reordering characters', () => {
    const source = '0123456789'.repeat(103);
    const chunks = splitDocumentEvenly(source, 17);
    expect(chunks.map((c) => c.text).join('')).toBe(source);
    expect(chunks).toHaveLength(17);
    expect(chunks[0].start).toBe(0);
    expect(chunks.at(-1)?.end).toBe(source.length);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].start).toBe(chunks[i - 1].end);
  });

  it('uses 1–10 workers for small files, 25 for medium, and 100 for large files', () => {
    expect(planDocument({ name: 'tiny.txt', text: 'hello' }).agentCount).toBe(1);
    expect(planDocument({ name: 'small.txt', text: 'x'.repeat(12_000) }).agentCount).toBe(8);
    expect(planDocument({ name: 'medium.txt', text: 'x'.repeat(12_001) }).agentCount).toBe(25);
    expect(planDocument({ name: 'large.txt', text: 'x'.repeat(80_001) }).agentCount).toBe(100);
  });

  it('assigns each file its own size-based worker count', () => {
    const small = planDocument({ name: 'small', text: 'a'.repeat(3000) }, 0);
    const medium = planDocument({ name: 'medium', text: 'b'.repeat(20_000) }, 1);
    const large = planDocument({ name: 'large', text: 'c'.repeat(90_000) }, 2);
    expect([small.agentCount, medium.agentCount, large.agentCount]).toEqual([2, 25, 100]);
    expect([small, medium, large].map((p) => p.chunks.map((c) => c.text).join(''))).toEqual([
      'a'.repeat(3000), 'b'.repeat(20_000), 'c'.repeat(90_000)
    ]);
  });
});

describe('document answer grounding/review', () => {
  it('passes the question to workers and adds an independent relevance review', async () => {
    const calls: Array<{ system?: string; prompt?: string }> = [];
    const ask = vi.fn(async (request: { system?: string; prompt?: string }) => {
      calls.push(request);
      if (request.system?.includes('Independent relevance')) {
        return { content: 'RELEVANCE: 5/5\nCOVERAGE: 4/5\nGROUNDING: 5/5\nREVISED ANSWER: The file says the release is Friday.', thinking: null };
      }
      return { content: 'DIRECT ANSWER: The release is Friday. SOURCE EVIDENCE: “release is Friday”. UNCERTAINTIES: none.', thinking: null };
    }) as unknown as AskFn;
    const result = await processDocument(ask, { name: 'release.txt', text: 'The release is Friday.' }, 'When is the release?', { concurrency: 2 });
    expect(result.plan.agentCount).toBe(1);
    expect(result.relevanceScore).toBe(5);
    expect(result.answer).toContain('The file says the release is Friday.');
    expect(calls.some((c) => c.prompt?.includes('When is the release?'))).toBe(true);
    expect(calls.some((c) => c.system?.includes('Independent relevance'))).toBe(true);
  });
});


describe('configurable worker allocations and independent reviewers', () => {
  it('bounds prompt chunk size even when a file is assigned one worker', () => {
    const source = 'x'.repeat(48_000);
    const plan = planDocument({ name: 'long.txt', text: source }, 0, 1);
    expect(plan.agentCount).toBe(1);
    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(Math.max(...plan.chunks.map((chunk) => chunk.text.length))).toBeLessThanOrEqual(3_000);
    expect(plan.chunks.map((chunk) => chunk.text).join('')).toBe(source);
  });

  it('clamps per-file worker overrides to 1..100 and uses them for chunk planning', () => {
    expect(planDocument({ name: 'custom.txt', text: 'x'.repeat(5000) }, 0, 4).agentCount).toBe(4);
    expect(planDocument({ name: 'too-many.txt', text: 'x'.repeat(5000) }, 0, 500).agentCount).toBe(100);
    expect(planDocument({ name: 'zero.txt', text: 'x'.repeat(5000) }, 0, 0).agentCount).toBe(1);
  });

  it('includes independent reviewer scores in the final relevance score and exposes low-score warnings', async () => {
    const primary = vi.fn(async (request: { system?: string; prompt?: string }) => ({
      content: request.system?.includes('Independent relevance')
        ? 'RELEVANCE: 5/5\\nCOVERAGE: 5/5\\nGROUNDING: 5/5\\nREVISED ANSWER: The release is Friday.'
        : 'DIRECT ANSWER: Friday. SOURCE EVIDENCE: release is Friday.',
      thinking: null
    })) as unknown as AskFn;
    const reviewer = vi.fn(async () => ({
      content: 'RELEVANCE: 1/5\\nCOVERAGE: 2/5\\nGROUNDING: 2/5\\nCONTRADICTIONS: none\\nREVISED ANSWER: Friday.',
      thinking: null
    })) as unknown as AskFn;
    const result = await processDocument(primary, { id: 'release', name: 'release.txt', text: 'The release is Friday.' }, 'When is the release?', {
      workerAllocations: { release: 3 },
      reviewers: [{ id: 'independent-a', label: 'Independent A', ask: reviewer }]
    });
    expect(result.plan.agentCount).toBe(3);
    expect(result.relevanceScore).toBe(3);
    expect(result.review).toContain('INDEPENDENT REVIEWER Independent A');
    expect(result.answer).toContain('INDEPENDENT REVIEW WARNINGS');
    expect(reviewer).toHaveBeenCalled();
  });
});


describe('large multi-file evidence combination', () => {
  it('reduces every batch hierarchically instead of truncating material after 55,000 characters', async () => {
    const source = 'SOURCE-START\\n' + Array.from({ length: 140 }, (_, i) => 'FILE-' + i + ' ' + 'distinct-evidence-'.repeat(40)).join('\\n') + '\\nSOURCE-END';
    const prompts: string[] = [];
    const ask = vi.fn(async (request: { system?: string; prompt?: string }) => {
      prompts.push(request.prompt ?? '');
      return {
        content: request.system?.includes('Evidence-preserving document reducer')
          ? 'Evidence ledger ' + prompts.length + ': preserved source identifiers and claims.'
          : 'FINAL: all source batches were reviewed.',
        thinking: null,
      };
    }) as unknown as AskFn;
    const result = await combineDocumentMaterial(ask, 'Compare all evidence', source);
    expect(result).toContain('all source batches were reviewed');
    expect(prompts.length).toBeGreaterThan(2);
    expect(prompts.some((prompt) => prompt.includes('SOURCE-END'))).toBe(true);
    expect(prompts.every((prompt) => prompt.length < DOCUMENT_COMBINE_BATCH_CHARS + 1_000)).toBe(true);
    expect(prompts.some((prompt) => prompt.includes('REDUCTION LEVEL: 2'))).toBe(true);
  });

  it('fails visibly if an evidence-reduction call returns no content', async () => {
    const ask = vi.fn(async () => ({ content: '', thinking: null })) as unknown as AskFn;
    await expect(combineDocumentMaterial(ask, 'Review', 'x'.repeat(DOCUMENT_COMBINE_BATCH_CHARS + 1)))
      .rejects.toThrow(/empty evidence reduction/);
  });
});
