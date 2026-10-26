import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGES, STAGES, createStageControllers, sanitizeStages, stageOf, stageOff, toggleMessage, unverifiedStages } from './loop-control.js';

describe('loop-control catalogue', () => {
  it('covers every pipeline stage and agent, and no guardrail', () => {
    const ids = STAGES.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['planner', 'grounding', 'executor', 'reflect', 'verdict', 'autoContinue', 'screenResponder']));
    expect(ids).toEqual(expect.arrayContaining(['popup', 'drift', 'progress', 'goal', 'screenWatcher', 'coords', 'supervisor', 'elementMap', 'subagents']));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => /arm|abort|budget|hotkey/i.test(id))).toBe(false);
  });

  it('defaults every stage on', () => {
    expect(Object.values(DEFAULT_STAGES).every((v) => v === true)).toBe(true);
    expect(Object.keys(DEFAULT_STAGES)).toHaveLength(STAGES.length);
  });

  it('describes a stage by id', () => {
    expect(stageOf('reflect')).toMatchObject({ group: 'pipeline', name: 'Reflect', verifies: true });
    expect(stageOff('popup')).toBe('Popup watcher stage is unchecked in Loop control');
  });
});

describe('sanitizeStages', () => {
  it('merges stored booleans over all-on defaults, dropping unknown keys and non-booleans', () => {
    expect(sanitizeStages({ reflect: false, drift: 'no', bogus: false })).toEqual({ ...DEFAULT_STAGES, reflect: false });
  });

  it('returns the defaults for non-object input', () => {
    for (const raw of [undefined, null, 3, 'x', [false]]) expect(sanitizeStages(raw)).toEqual(DEFAULT_STAGES);
  });
});

describe('unverifiedStages and toggleMessage', () => {
  it('lists only verification stages that are off', () => {
    const off = unverifiedStages({ ...DEFAULT_STAGES, grounding: false, planner: false, verdict: false });
    expect(off.map((s) => s.id)).toEqual(['grounding', 'verdict']);
    expect(unverifiedStages(DEFAULT_STAGES)).toEqual([]);
  });

  it('says what a toggle did', () => {
    expect(toggleMessage('drift', true)).toBe('Drift monitor enabled');
    expect(toggleMessage('reflect', false)).toMatch(/^Reflect disabled — its in-flight AI calls were cancelled$/);
  });
});

describe('createStageControllers', () => {
  it('cancel aborts only that stage and arms a fresh signal', () => {
    const ctrls = createStageControllers();
    const reflect = ctrls.signal('reflect');
    const planner = ctrls.signal('planner');
    ctrls.cancel('reflect');
    expect(reflect.aborted).toBe(true);
    expect(planner.aborted).toBe(false);
    expect(ctrls.signal('reflect').aborted).toBe(false);
    expect(ctrls.signal('reflect')).not.toBe(reflect);
  });
});
