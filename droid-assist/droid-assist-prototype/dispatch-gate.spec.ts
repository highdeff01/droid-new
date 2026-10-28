import { describe, expect, it } from 'vitest';
import type { Habit, LearnedPattern, WorkflowStep } from './types.js';
import type { MappedElement } from './element-map-studio.js';
import type { Knowledge } from './cross-reference.js';
import { AI_DOWN_PAUSE, AI_DOWN_STRIKES, BREAKER_IDLE, MODE_PAUSE, avoidPoints, dispatchKey, gateStep, modePauseText, pauseReason, strike } from './dispatch-gate.js';
import { runGoalFor } from './packs.js';

const step = (over: Partial<WorkflowStep> = {}): WorkflowStep => ({ id: 's1', name: 'Click 6', action: 'click', target: 'Click 6', x: 0.06, y: 0.599, status: 'pending', ...over });
const habit = (avoid: string): Habit => ({ id: 'h1', target: 'Click 6', context: '', attempts: 3, successes: 0, lastUsed: 1, pinned: false, lessons: [{ kind: 'avoid', text: avoid, time: 1 }] });
const mapped = (name: string, x: number, y: number): MappedElement => ({ id: name, name, box: { x: x - 0.02, y: y - 0.02, w: 0.04, h: 0.04 }, mappedAt: 1 });
const knowledge = (over: Partial<Knowledge> = {}): Knowledge => ({ map: [], familiar: [], habits: [], patterns: [], failures: [], dossiers: [], memory: [], context: '', ...over });
const OBSERVED = 'click "Click 6" failed after 3 attempt(s) at (6.0%, 59.9%): Click hit nothing interactive';

describe('gateStep — avoid entries', () => {
  it('blocks the observed blacklisted click at its recorded point, with the avoid reason', () => {
    const block = gateStep(step(), knowledge({ habits: [habit(OBSERVED)] }), true);
    expect(block).toMatchObject({ kind: 'avoid' });
    expect(block?.reason).toContain('Click hit nothing interactive');
  });

  it('blocks on the corrected point a re-grounding left on the step', () => {
    expect(gateStep(step({ x: 0.5, y: 0.5, correctedX: 0.061, correctedY: 0.6 }), knowledge({ habits: [habit(OBSERVED)] }), true)?.kind).toBe('avoid');
  });

  it('lets the same target dispatch at a point away from every blacklisted one', () => {
    expect(gateStep(step({ x: 0.4, y: 0.2 }), knowledge({ habits: [habit(OBSERVED)] }), true)).toBeNull();
  });

  it('an avoid entry that names no point blacklists the target anywhere', () => {
    expect(gateStep(step({ x: 0.9, y: 0.9 }), knowledge({ habits: [habit('never click Click 6 here')] }), false)?.kind).toBe('avoid');
  });

  it('a learned avoid pattern naming the target blocks it', () => {
    const pattern: LearnedPattern = { id: 'p1', kind: 'avoid', pattern: 'clicking Click 6 at (6.0%, 60.0%)', context: '', time: 1 };
    expect(gateStep(step(), knowledge({ patterns: [pattern] }), false)?.reason).toMatch(/Learned avoid/);
  });

  it('reads the points an avoid entry names', () => {
    expect(avoidPoints('at (6.0%, 59.9%), (10%, 20.5%)')).toEqual([{ x: 0.06, y: 0.599 }, { x: 0.1, y: 0.205 }]);
  });
});

describe('gateStep — mapped-element conflict', () => {
  it('a mapped element of another name over the point marks the coordinates stale', () => {
    const block = gateStep(step(), knowledge({ map: [mapped('region at R10C2', 0.06, 0.6)] }), true);
    expect(block).toMatchObject({ kind: 'stale' });
    expect(block?.reason).toContain('"region at R10C2"');
    expect(block?.reason).toContain('not "Click 6"');
  });

  it('a mapped element named like the target agrees with the plan', () => {
    expect(gateStep(step(), knowledge({ map: [mapped('Click 6 button', 0.06, 0.6)] }), true)).toBeNull();
  });

  it('is not checked for non-pointer steps or when stale checking is off', () => {
    const k = knowledge({ map: [mapped('region at R10C2', 0.06, 0.6)] });
    expect(gateStep(step({ action: 'type' }), k, true)).toBeNull();
    expect(gateStep(step(), k, false)).toBeNull();
  });
});

describe('AI-down circuit breaker', () => {
  it('pauses after AI_DOWN_STRIKES unresolved iterations with the endpoint down', () => {
    const one = strike(BREAKER_IDLE, false);
    expect(one).toEqual({ strikes: 1, paused: null });
    expect(strike(one, false)).toEqual({ strikes: AI_DOWN_STRIKES, paused: AI_DOWN_PAUSE });
    expect(AI_DOWN_PAUSE).toBe('paused: AI endpoint down; step needs re-grounding');
  });

  it('a hard strike (stale coordinates) pauses at once; nothing counts while the AI is up', () => {
    expect(strike(BREAKER_IDLE, false, true).paused).toBe(AI_DOWN_PAUSE);
    expect(strike(BREAKER_IDLE, true, true)).toBe(BREAKER_IDLE);
  });
});

describe('execution mode pause', () => {
  it('Watching pauses pack dispatch whatever the breaker says; other modes defer to the breaker', () => {
    expect(pauseReason('watching', BREAKER_IDLE)).toBe(MODE_PAUSE);
    expect(pauseReason('thoughtful', BREAKER_IDLE)).toBeNull();
    expect(pauseReason('parallel', { strikes: 2, paused: AI_DOWN_PAUSE })).toBe(AI_DOWN_PAUSE);
  });

  it('a mode change says what paused or resumed', () => {
    expect(modePauseText('thoughtful', 'watching')).toMatch(/dispatches paused/);
    expect(modePauseText('watching', 'tracking')).toMatch(/dispatches resumed/);
    expect(modePauseText('thoughtful', 'parallel')).toBe('');
  });
});

describe('derived run goals', () => {
  it('a pack run with no goal gets one from its name and step count', () => {
    expect(runGoalFor('Pack "Click 6"', [step()])).toBe('Run pack "Click 6" (1 step)');
    expect(runGoalFor('Cross-run', [step(), step({ id: 's2' })])).toBe('Run Cross-run (2 steps)');
  });

  it('a dispatch is identified by its target and rounded point', () => {
    expect(dispatchKey(step())).toBe('click 6@6,60');
  });
});
