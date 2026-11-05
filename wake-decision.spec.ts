import { describe, expect, it, vi } from 'vitest';
import { AiParseError, SAMPLE_VIEW } from './ai.js';
import {
  DECISION_KINDS,
  DEFAULT_MAX_DISTANCE,
  askDecision,
  decisionText,
  dispatchDecision,
  parseDecision,
} from './wake-decision.js';
import type { DecisionHandlers, WakeDecision } from './wake-decision.js';

const reply = (obj: Record<string, unknown>) => JSON.stringify(obj);

describe('parseDecision', () => {
  it.each([
    ['apply', { decision: 'apply', reason: 'ready now' }],
    ['reroute', { decision: 'reroute', reason: 'plan changed' }],
    ['stop', { decision: 'stop', reason: 'done' }],
  ])('parses a %s decision with its reason', (kind, obj) => {
    const d = parseDecision(reply(obj));
    expect(d.kind).toBe(kind);
    expect(d.reason).toBe(obj.reason);
  });

  it('parses a wait decision with waitMs', () => {
    const d = parseDecision(reply({ decision: 'wait', reason: 'still loading', waitMs: 45000 }));
    expect(d.kind).toBe('wait');
    expect(d.waitMs).toBe(45000);
  });

  it('parses an alternate decision with its method', () => {
    const d = parseDecision(reply({ decision: 'alternate', reason: 'blocked', method: 'use the keyboard shortcut' }));
    expect(d.kind).toBe('alternate');
    expect(d.method).toBe('use the keyboard shortcut');
  });

  it('parses a new decision with its goal', () => {
    const d = parseDecision(reply({ decision: 'new', reason: 'abandon this', goal: 'Open settings instead' }));
    expect(d.kind).toBe('new');
    expect(d.goal).toBe('Open settings instead');
  });

  it('parses a parallel decision with fraction subject/anchor and maxDistance', () => {
    const d = parseDecision(reply({
      decision: 'parallel',
      reason: 'keep her close',
      goal: 'keep girl near guy',
      subject: { name: 'girl', x: 0.1, y: 0.2 },
      anchor: { name: 'guy', x: 0.6, y: 0.6 },
      maxDistance: 0.3,
    }));
    expect(d.kind).toBe('parallel');
    expect(d.parallel).toEqual({ goal: 'keep girl near guy', subject: { name: 'girl', x: 0.1, y: 0.2 }, anchor: { name: 'guy', x: 0.6, y: 0.6 }, maxDistance: 0.3 });
  });

  it('converts pixel values above 1 to fractions using the view size', () => {
    const d = parseDecision(reply({
      decision: 'parallel',
      reason: 'keep her close',
      subject: { name: 'girl', x: 240, y: 0 },
      anchor: { name: 'guy', x: 0, y: 0 },
    }), null, SAMPLE_VIEW);
    expect(d.parallel?.subject.x).toBe(0.5);
  });

  it('defaults maxDistance to DEFAULT_MAX_DISTANCE when missing', () => {
    const d = parseDecision(reply({
      decision: 'parallel',
      reason: 'keep her close',
      subject: { name: 'girl', x: 0.1, y: 0.2 },
      anchor: { name: 'guy', x: 0.6, y: 0.6 },
    }));
    expect(d.parallel?.maxDistance).toBe(DEFAULT_MAX_DISTANCE);
  });

  it('reads an unknown decision kind as stop', () => {
    const d = parseDecision(reply({ decision: 'explode', reason: 'boom' }));
    expect(d.kind).toBe('stop');
  });

  it('reads new without a goal as stop', () => {
    const d = parseDecision(reply({ decision: 'new', reason: 'abandon' }));
    expect(d.kind).toBe('stop');
  });

  it('reads parallel without an anchor as stop', () => {
    const d = parseDecision(reply({ decision: 'parallel', reason: 'keep close', subject: { name: 'girl', x: 0.1, y: 0.2 } }));
    expect(d.kind).toBe('stop');
  });

  it('throws AiParseError on a reply without JSON', () => {
    expect(() => parseDecision('sure, I will apply it')).toThrow(AiParseError);
  });

  it('parses JSON found inside prose and think tags', () => {
    const content = `<think>let me consider</think>I have decided. ${reply({ decision: 'apply', reason: 'ready' })} Thanks.`;
    const d = parseDecision(content);
    expect(d.kind).toBe('apply');
    expect(d.reason).toBe('ready');
  });
});

describe('dispatchDecision', () => {
  it('calls exactly the handler of the decision kind and returns its value', () => {
    const handlers: DecisionHandlers<string> = {
      apply: vi.fn(() => 'apply-result'),
      reroute: vi.fn(() => 'reroute-result'),
      stop: vi.fn(() => 'stop-result'),
      alternate: vi.fn(() => 'alternate-result'),
      wait: vi.fn(() => 'wait-result'),
      new: vi.fn(() => 'new-result'),
      parallel: vi.fn(() => 'parallel-result'),
    };
    const decision: WakeDecision = { kind: 'apply', reason: 'ready', thinking: null };
    const result = dispatchDecision(decision, handlers);
    expect(result).toBe('apply-result');
    expect(handlers.apply).toHaveBeenCalledWith(decision);
    for (const kind of DECISION_KINDS) {
      if (kind === 'apply') continue;
      expect(handlers[kind]).not.toHaveBeenCalled();
    }
  });
});

describe('askDecision', () => {
  it('asks once with the request and parses the reply, carrying the thinking', async () => {
    const ask = vi.fn(async () => ({ content: reply({ decision: 'apply', reason: 'ready' }), thinking: 't' }));
    const req = { system: () => 'sys', prompt: 'p', json: true };
    const d = await askDecision(ask, req);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith(req);
    expect(d.kind).toBe('apply');
    expect(d.thinking).toBe('t');
  });
});

describe('decisionText', () => {
  it('includes the seconds for a wait decision', () => {
    const text = decisionText({ kind: 'wait', reason: 'still loading', waitMs: 45000, thinking: null });
    expect(text).toContain('45 s');
  });

  it('includes the goal for a new decision', () => {
    const text = decisionText({ kind: 'new', reason: 'abandon', goal: 'Open settings', thinking: null });
    expect(text).toContain('Open settings');
  });

  it('starts with the uppercase kind', () => {
    const text = decisionText({ kind: 'apply', reason: 'ready', thinking: null });
    expect(text.startsWith('APPLY')).toBe(true);
  });
});
