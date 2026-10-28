import { describe, expect, it, vi } from 'vitest';
import {
  autoApplyDecision,
  bestGrounding,
  DEFAULT_AUTO_APPLY,
  groundGoal,
  groundingShift,
  judgeCandidate,
  JUDGE_SYSTEM,
  sanitizeAutoApply,
  type AutoApplyBounds,
  type KnownGrounding,
  type Judgment,
} from './aggressive.js';
import type { AskFn } from './ai.js';
import type { Knowledge } from './cross-reference.js';
import type { MappedElement } from './element-map-studio.js';
import type { FamiliarElement, WorkflowStep } from './types.js';

const knowledge = (over: Partial<Knowledge> = {}): Knowledge => ({ map: [], familiar: [], habits: [], patterns: [], failures: [], dossiers: [], memory: [], context: 'Files App', ...over });

const mapped = (over: Partial<MappedElement> = {}): MappedElement => ({ id: 'e1', name: 'Files', box: { x: 0.1, y: 0.2, w: 0.2, h: 0.2 }, mappedAt: 0, ...over });

const familiar = (over: Partial<FamiliarElement> = {}): FamiliarElement => ({ id: 'f1', name: 'Files icon', x: 0.4, y: 0.5, lastSeen: 0, ...over });

const step = (over: Partial<WorkflowStep> = {}): WorkflowStep => ({ id: 's1', name: 'Step', action: 'click', x: 0.5, y: 0.5, status: 'pending', ...over });

const grounding = (over: Partial<KnownGrounding> = {}): KnownGrounding => ({ x: 0.5, y: 0.5, source: 'mapped', name: 'g', ...over });

const judgment = (over: Partial<Judgment> = {}): Judgment => ({ fair: true, inScope: true, confidence: 0.9, reason: '', thinking: null, ...over });

const bounds = (over: Partial<AutoApplyBounds> = {}): AutoApplyBounds => ({ enabled: true, minConfidence: 0.8, maxShift: 0.05, maxPerRun: 5, ...over });

describe('sanitizeAutoApply', () => {
  it.each([undefined, null, 'x', []])('falls back to defaults for %j', (raw) => {
    expect(sanitizeAutoApply(raw)).toEqual(DEFAULT_AUTO_APPLY);
  });

  it('keeps a fully valid custom set of bounds', () => {
    const custom = { enabled: true, minConfidence: 0.6, maxShift: 0.1, maxPerRun: 2 };
    expect(sanitizeAutoApply(custom)).toEqual(custom);
  });

  it.each([1.5, -0.1])('falls back minConfidence %s to the default', (minConfidence) => {
    expect(sanitizeAutoApply({ minConfidence }).minConfidence).toBe(DEFAULT_AUTO_APPLY.minConfidence);
  });

  it.each([0.9, NaN])('falls back maxShift %s to the default', (maxShift) => {
    expect(sanitizeAutoApply({ maxShift }).maxShift).toBe(DEFAULT_AUTO_APPLY.maxShift);
  });

  it.each([0, 2.5, Infinity])('falls back maxPerRun %s to the default, never unlimited', (maxPerRun) => {
    expect(sanitizeAutoApply({ maxPerRun }).maxPerRun).toBe(DEFAULT_AUTO_APPLY.maxPerRun);
  });

  it('falls back a non-boolean enabled to false', () => {
    expect(sanitizeAutoApply({ enabled: 'yes' }).enabled).toBe(false);
  });
});

describe('autoApplyDecision', () => {
  it('applies a fair, in-scope, confident candidate within shift and under the per-run cap', () => {
    const decision = autoApplyDecision(judgment(), 0.02, 0, bounds());
    expect(decision.apply).toBe(true);
  });

  it('holds when auto-apply is off', () => {
    const decision = autoApplyDecision(judgment(), 0.02, 0, bounds({ enabled: false }));
    expect(decision.apply).toBe(false);
    expect(decision.reason).toContain('off');
  });

  it('holds when the AI did not judge it fair', () => {
    const decision = autoApplyDecision(judgment({ fair: false }), 0.02, 0, bounds());
    expect(decision.apply).toBe(false);
    expect(decision.reason).toContain('fair');
  });

  it('holds when the AI judged it out of scope', () => {
    const decision = autoApplyDecision(judgment({ inScope: false }), 0.02, 0, bounds());
    expect(decision.apply).toBe(false);
    expect(decision.reason).toContain('scope');
  });

  it('holds when confidence is below the minimum', () => {
    const decision = autoApplyDecision(judgment({ confidence: 0.7 }), 0.02, 0, bounds());
    expect(decision.apply).toBe(false);
    expect(decision.reason).toContain('confidence');
  });

  it('holds when the shift exceeds the bound', () => {
    const decision = autoApplyDecision(judgment(), 0.08, 0, bounds());
    expect(decision.apply).toBe(false);
  });

  it('holds once the per-run cap is reached', () => {
    const decision = autoApplyDecision(judgment(), 0.02, 5, bounds());
    expect(decision.apply).toBe(false);
  });

  it('applies at the exact confidence and shift boundary', () => {
    const decision = autoApplyDecision(judgment({ confidence: 0.8 }), 0.05, 0, bounds());
    expect(decision.apply).toBe(true);
  });
});

describe('bestGrounding', () => {
  it('grounds a target on a mapped element whose name is a subset of the target', () => {
    const g = bestGrounding('Files icon', knowledge({ map: [mapped()] }));
    expect(g?.source).toBe('mapped');
    expect(g?.name).toBe('Files');
    expect(g?.x).toBeCloseTo(0.2);
    expect(g?.y).toBeCloseTo(0.3);
  });

  it('falls back to a familiar element when nothing is mapped', () => {
    const g = bestGrounding('Files icon', knowledge({ familiar: [familiar()] }));
    expect(g).toEqual({ x: 0.4, y: 0.5, source: 'familiar', name: 'Files icon' });
  });

  it('prefers a mapped element over a familiar one when both exist', () => {
    const g = bestGrounding('Files icon', knowledge({ map: [mapped()], familiar: [familiar()] }));
    expect(g?.source).toBe('mapped');
  });

  it('returns null when nothing is known about the target', () => {
    expect(bestGrounding('Files icon', knowledge())).toBeNull();
  });
});

describe('groundGoal', () => {
  it('turns a click goal into a click step at the familiar point', () => {
    const s = groundGoal('click the Files icon', knowledge({ familiar: [familiar()] }));
    expect(s).toMatchObject({ action: 'click', target: 'Files icon', x: 0.4, y: 0.5 });
  });

  it('turns a move goal into a move step', () => {
    const s = groundGoal('move the mouse to Files icon', knowledge({ familiar: [familiar()] }));
    expect(s?.action).toBe('move');
  });

  it('returns null for a goal with no recognised pointer verb', () => {
    expect(groundGoal('open the report', knowledge({ familiar: [familiar()] }))).toBeNull();
  });

  it('returns null when the target is not grounded in knowledge', () => {
    expect(groundGoal('click Unknown thing', knowledge())).toBeNull();
  });
});

describe('judgeCandidate', () => {
  it('parses a full judgment and asks with json:true and the judge system prompt', async () => {
    const ask: AskFn = vi.fn(async () => ({ content: '{"fair":true,"inScope":true,"confidence":0.92,"reason":"ok"}', thinking: 't' }));
    const result = await judgeCandidate(ask, null, step(), grounding(), 'goal');
    expect(result).toEqual({ fair: true, inScope: true, confidence: 0.92, reason: 'ok', thinking: 't' });
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ system: JUDGE_SYSTEM, json: true }));
  });

  it('judges unfair with zero confidence when the reply carries no usable verdict', async () => {
    const ask: AskFn = vi.fn(async () => ({ content: '{"fair":"yes"}', thinking: null }));
    const result = await judgeCandidate(ask, null, step(), grounding(), 'goal');
    expect(result.fair).toBe(false);
    expect(result.inScope).toBe(false);
    expect(result.confidence).toBe(0);
  });
});

describe('groundingShift', () => {
  it('is the normalised distance between the step and the grounded point', () => {
    expect(groundingShift(step({ x: 0.5, y: 0.5 }), grounding({ x: 0.53, y: 0.54 }))).toBeCloseTo(0.05);
  });
});
