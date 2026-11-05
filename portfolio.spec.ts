import { describe, expect, it } from 'vitest';
import { PORTFOLIO_LIMIT, actorLabel, addPortfolioEntry, aiActor, isPortfolioEntry, portfolioActors, queryPortfolio, type PortfolioEntry } from './portfolio.js';

const src = (operation: string, opId: string | null = 'plan_1') => ({ operation, opId });

describe('portfolio attribution', () => {
  it('keeps each actor\'s entries separate, timestamped and referencing their source operation', () => {
    let list: PortfolioEntry[] = [];
    list = addPortfolioEntry(list, { actor: 'coords', kind: 'method', text: 'avoid double click', source: src('save the doc') }, 100);
    list = addPortfolioEntry(list, { actor: aiActor('qwen'), kind: 'work', text: 'planned 3 steps', source: src('save the doc') }, 200);
    list = addPortfolioEntry(list, { actor: aiActor('llava'), kind: 'result', text: 'verdict ok', source: src('open mail', 'plan_2'), ok: true }, 300);
    expect(list[0].time).toBe(300);
    expect(queryPortfolio(list, { actor: 'coords' })).toEqual([expect.objectContaining({ kind: 'method', text: 'avoid double click', time: 100, source: { operation: 'save the doc', opId: 'plan_1' } })]);
    expect(queryPortfolio(list, { actor: 'ai:qwen' }).map((e) => e.text)).toEqual(['planned 3 steps']);
    expect(queryPortfolio(list, { actor: 'ai:llava', kind: 'result' })[0].ok).toBe(true);
    expect(queryPortfolio(list, { operation: 'save the doc' })).toHaveLength(2);
    expect(queryPortfolio(list, { actor: 'coords', kind: 'result' })).toEqual([]);
    expect(portfolioActors(list)).toEqual(['ai:llava', 'ai:qwen', 'coords']);
    expect(new Set(list.map((e) => e.id)).size).toBe(3);
  });

  it('labels the main AI, connected models and agents', () => {
    const names = { coords: 'Coordinate learner' };
    expect(actorLabel('ai:qwen', names, 'qwen')).toContain('(main)');
    expect(actorLabel('ai:llava', names, 'qwen')).toContain('(connected)');
    expect(actorLabel('coords', names, 'qwen')).toBe('Coordinate learner');
    expect(actorLabel('Self-test', names, 'qwen')).toBe('Self-test');
  });

  it('caps the store at PORTFOLIO_LIMIT, dropping the oldest', () => {
    let list: PortfolioEntry[] = [];
    for (let i = 0; i <= PORTFOLIO_LIMIT; i++) list = addPortfolioEntry(list, { actor: 'goal', kind: 'note', text: `n${i}`, source: src('') }, i);
    expect(list).toHaveLength(PORTFOLIO_LIMIT);
    expect(list.at(-1)?.text).toBe('n1');
  });

  it('rejects stored entries without a source or with an unknown kind', () => {
    const ok = { id: 'a', actor: 'goal', kind: 'note', text: 't', time: 1, source: { operation: '', opId: null } };
    expect(isPortfolioEntry(ok)).toBe(true);
    expect(isPortfolioEntry({ ...ok, source: undefined })).toBe(false);
    expect(isPortfolioEntry({ ...ok, kind: 'gossip' })).toBe(false);
  });
});
