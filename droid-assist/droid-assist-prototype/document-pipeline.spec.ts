import { describe, expect, it, vi } from 'vitest';
import type { AskFn } from './ai.js';
import { planDocument, processDocument, splitDocumentEvenly } from './document-pipeline.js';

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
