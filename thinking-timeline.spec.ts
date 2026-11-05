import { describe, expect, it } from 'vitest';
import { TIMELINE_LIMIT, addEntry, verdictText, type ThinkingEntry } from './thinking-timeline.js';

describe('addEntry', () => {
  it('prepends a timestamped entry with an id', () => {
    const t = addEntry([], { step: 'Press play', kind: 'thought', text: 'run', thinking: null });
    const next = addEntry(t, { step: 'Press play', kind: 'verdict', text: 'SUCCESS', thinking: 'ok' });
    expect(next.map((e) => e.kind)).toEqual(['verdict', 'thought']);
    expect(next[0].id).not.toBe(next[1].id);
    expect(typeof next[0].time).toBe('number');
  });

  it('keeps only the newest TIMELINE_LIMIT entries', () => {
    let t: ThinkingEntry[] = [];
    for (let i = 0; i < TIMELINE_LIMIT + 5; i++) t = addEntry(t, { step: `s${i}`, kind: 'thought', text: '', thinking: null });
    expect(t).toHaveLength(TIMELINE_LIMIT);
    expect(t[0].step).toBe(`s${TIMELINE_LIMIT + 4}`);
  });
});

describe('verdictText', () => {
  it('summarises success and both patterns', () => {
    expect(verdictText({ success: true, pattern_avoid: 'banner', pattern_add: 'wait', thinking: null })).toBe('SUCCESS · avoid: banner · add: wait');
  });
  it('summarises a failure without patterns', () => {
    expect(verdictText({ success: false, pattern_avoid: null, pattern_add: null, thinking: null })).toBe('FAILED');
  });
});
