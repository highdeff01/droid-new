import { describe, expect, it, vi } from 'vitest';
import { chainReport, discoverTarget, isChainGoal, locateTarget, parseChain, parseDiscovery, planChain, splitClauses, type ChainObjective } from './chain.js';
import { AiError, SAMPLE_VIEW, systemText } from './ai.js';
import type { AskFn } from './ai.js';
import type { FamiliarElement } from './types.js';
import type { MappedElement } from './element-map-studio.js';

const askReturning = (content: string, thinking: string | null = null) => vi.fn<AskFn>(async () => ({ content, thinking }));

const objective = (name: string, status: ChainObjective['status'], reason?: string): ChainObjective => ({
  id: name, name, what: `click ${name}`, why: 'goal', path: [], discover: null, status, reason,
  step: { id: name, name, action: 'click', x: 0.5, y: 0.5, target: name, status: 'pending' },
});

describe('isChainGoal / splitClauses', () => {
  it('treats comma, semicolon and "then" separated goals as chains', () => {
    expect(splitClauses('open Settings; pick Display then press Apply, and close it')).toEqual(['open Settings', 'pick Display', 'press Apply', 'close it']);
    expect(isChainGoal('open Settings then press Apply')).toBe(true);
  });

  it('keeps single-clause goals (even with "and") on the single plan path', () => {
    expect(isChainGoal('dismiss the ads and play the videos')).toBe(false);
    expect(isChainGoal('open the files icon')).toBe(false);
  });
});

describe('parseChain', () => {
  it('parses each objective with what, why, step, path and discovery hint', () => {
    const reply = '{"objectives":[{"name":"Open Options","what":"click Options","why":"the volume lives there","action":"click","target":"Options button","cell":"B2","cx":0.5,"cy":0.5,"path":["Main menu"]},{"name":"Talk","what":"click Talk","why":"greets the priest","action":"click","target":"Talk option","discover":"behind the Profile tab"}]}';
    const [a, b] = parseChain(reply, null);
    expect(a).toMatchObject({ name: 'Open Options', what: 'click Options', why: 'the volume lives there', path: ['Main menu'], discover: null, status: 'pending' });
    expect(a.step).toMatchObject({ action: 'click', target: 'Options button' });
    expect(a.step.unlocated).toBeUndefined();
    expect(b).toMatchObject({ discover: 'behind the Profile tab', path: [] });
    expect(b.step).toMatchObject({ action: 'click', target: 'Talk option', unlocated: true });
  });

  it('rejects an empty breakdown or an unknown action', () => {
    expect(() => parseChain('{"objectives":[]}', null)).toThrow(AiError);
    expect(() => parseChain('{"objectives":[{"name":"x","action":"teleport"}]}', null)).toThrow(/unknown action/);
  });

  it('planChain sends the clauses in order with the chain contract', async () => {
    const ask = askReturning('{"objectives":[{"name":"A","action":"click","target":"A","cell":"A1"}]}', 'thinking');
    const plan = await planChain('press A, then press B', null, ask, ['ctx']);
    const req = ask.mock.calls[0][0];
    expect(req.prompt).toContain('1. press A\n2. press B');
    expect(systemText(req.system, SAMPLE_VIEW)).toMatch(/MULTI-ELEMENT CHAIN/);
    expect(req.context).toEqual(['ctx']);
    expect(plan).toMatchObject({ thinking: 'thinking', objectives: [{ name: 'A' }] });
  });
});

describe('locateTarget', () => {
  const map: MappedElement[] = [{ id: 'm', name: 'Save button', box: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, mappedAt: 0 }];
  const familiar: FamiliarElement[] = [{ id: 'f', name: 'Save button', x: 0.9, y: 0.9, lastSeen: 0 }, { id: 'g', name: 'Help icon', x: 0.1, y: 0.8, lastSeen: 0 }];

  it('prefers the element map, then learned coordinates, else null', () => {
    expect(locateTarget('save button', map, familiar)).toEqual({ x: expect.closeTo(0.3), y: expect.closeTo(0.3), source: 'element map' });
    expect(locateTarget('Help icon', map, familiar)).toEqual({ x: 0.1, y: 0.8, source: 'learned coordinates' });
    expect(locateTarget('Quit', map, familiar)).toBeNull();
  });
});

describe('parseDiscovery / discoverTarget', () => {
  it('reads found, explore and give-up decisions', () => {
    expect(parseDiscovery('{"visible":true,"cell":"A1","cx":0.5,"cy":0.5,"why":"there"}', null)).toMatchObject({ kind: 'found', why: 'there' });
    const explore = parseDiscovery('{"visible":false,"step":{"name":"Open menu","action":"click","target":"Menu","cell":"A12"},"why":"talk is in the menu"}', null);
    expect(explore).toMatchObject({ kind: 'explore', step: { action: 'click', target: 'Menu' } });
    expect(parseDiscovery('{"visible":false,"step":null,"why":"nothing"}', null)).toMatchObject({ kind: 'give-up', why: 'nothing' });
  });

  it('rejects a discovery step that is not a scroll, click or move', () => {
    expect(() => parseDiscovery('{"visible":false,"step":{"name":"t","action":"type","text":"x"},"why":"?"}', null)).toThrow(AiError);
  });

  it('tells the agent the hint and what was already tried', async () => {
    const ask = askReturning('{"visible":false,"step":null,"why":"no"}');
    await discoverTarget(ask, null, { ...objective('Talk', 'running'), discover: 'behind the menu' }, ['scroll down']);
    expect(ask.mock.calls[0][0].prompt).toMatch(/Hint: behind the menu[\s\S]*Already tried: scroll down/);
  });
});

describe('chainReport', () => {
  it('is complete when every objective is done', () => {
    expect(chainReport([objective('A', 'done'), objective('B', 'done')])).toEqual({ complete: true, failed: null, text: 'Chain COMPLETE — 2/2 objectives done' });
  });

  it('names the failed objective, why, and counts what was not run', () => {
    const r = chainReport([objective('A', 'done'), objective('Talk', 'failed', 'not found'), objective('Type hi', 'not run')]);
    expect(r.complete).toBe(false);
    expect(r.failed).toEqual({ name: 'Talk', reason: 'not found' });
    expect(r.text).toBe('Chain INCOMPLETE — objective 2 "Talk" failed: not found (1/3 done, 1 not run)');
  });
});
