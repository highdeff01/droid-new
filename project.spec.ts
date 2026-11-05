import { describe, expect, it } from 'vitest';
import type { GoalCheck } from './assist-ai.js';
import {
  PROJECT_STATES,
  TRANSITIONS,
  completionCheck,
  consumeInjections,
  createProject,
  injectInfo,
  isProject,
  pruneProjects,
  transition,
  type Project,
  type ProjectState,
} from './project.js';

describe('transition', () => {
  const chain: ProjectState[] = ['working', 'waiting-for-reply', 'testing', 'replying', 'retesting', 'retrying', 'correcting', 'retesting', 'verifying', 'acting', 'follow-up', 'complete'];

  it('legal moves along the full documented chain succeed and log TurnRecord newest first', () => {
    let p = createProject('Deck', 'Make a slide deck');
    for (let i = 1; i < chain.length; i++) p = transition(p, chain[i], `step ${i}`, 1000 + i);
    expect(p.state).toBe('complete');
    expect(p.history).toHaveLength(chain.length - 1);
    expect(p.history[0]).toEqual({ turn: 0, time: 1000 + chain.length - 1, from: 'follow-up', to: 'complete', note: `step ${chain.length - 1}` });
    expect(p.history[p.history.length - 1]).toEqual({ turn: 0, time: 1001, from: 'working', to: 'waiting-for-reply', note: 'step 1' });
  });

  it('throws on an illegal move from working and from a complete project', () => {
    const p = createProject('Deck', 'Goal');
    expect(() => transition(p, 'acting', 'skip ahead')).toThrow(/Illegal project transition/);
    let done = transition(p, 'waiting-for-reply', 'n1');
    done = transition(done, 'testing', 'n2');
    done = transition(done, 'replying', 'n3');
    done = transition(done, 'verifying', 'n4');
    done = transition(done, 'acting', 'n5');
    done = transition(done, 'follow-up', 'n6');
    done = transition(done, 'complete', 'n7');
    expect(() => transition(done, 'working', 'resume')).toThrow(/Illegal project transition/);
  });

  it('sets completion.done true on complete and false on failed', () => {
    let p = createProject('Deck', 'Goal');
    p = transition(p, 'waiting-for-reply', 'n1');
    p = transition(p, 'testing', 'n2');
    p = transition(p, 'replying', 'n3');
    p = transition(p, 'verifying', 'n4');
    p = transition(p, 'acting', 'n5');
    p = transition(p, 'follow-up', 'n6');
    const completed = transition(p, 'complete', 'all done');
    expect(completed.completion).toMatchObject({ done: true, reason: 'all done' });

    let q = createProject('Deck2', 'Goal2');
    q = transition(q, 'testing', 'n1');
    q = transition(q, 'retrying', 'n2');
    const failed = transition(q, 'failed', 'gave up');
    expect(failed.completion).toMatchObject({ done: false, reason: 'gave up' });
  });
});

describe('TRANSITIONS', () => {
  it('every state appears as a key, every target is a PROJECT_STATES member, complete has no exits, every non-terminal active state can reach on-hold', () => {
    expect(new Set(Object.keys(TRANSITIONS))).toEqual(new Set(PROJECT_STATES));
    for (const targets of Object.values(TRANSITIONS)) for (const t of targets) expect(PROJECT_STATES).toContain(t);
    expect(TRANSITIONS.complete).toEqual([]);
    const active = PROJECT_STATES.filter((s) => s !== 'complete' && s !== 'failed' && s !== 'on-hold');
    for (const s of active) expect(TRANSITIONS[s]).toContain('on-hold');
  });
});

describe('completionCheck', () => {
  const check = (complete: boolean, reason = 'ok'): GoalCheck => ({ complete, progress: true, reason, thinking: '' });

  it('an incomplete goal is not done', () => {
    const p = createProject('N', 'G');
    const result = completionCheck(p, check(false, 'not there yet'), 0);
    expect(result.done).toBe(false);
    expect(result.reason).toContain('not there yet');
  });

  it('a complete goal with a pending injection is not done', () => {
    const p = injectInfo(createProject('N', 'G'), { source: 'user', from: 'you', text: 'more info' });
    expect(completionCheck(p, check(true), 0).done).toBe(false);
  });

  it('a complete goal with pending approvals is not done', () => {
    const p = createProject('N', 'G');
    expect(completionCheck(p, check(true), 2).done).toBe(false);
  });

  it('a complete goal with nothing pending is done', () => {
    const p = createProject('N', 'G');
    const result = completionCheck(p, check(true, 'all good'), 0);
    expect(result.done).toBe(true);
    expect(result.reason).toContain('all good');
  });
});

describe('injectInfo and consumeInjections', () => {
  it('logs an injection with source, from and time', () => {
    const p = injectInfo(createProject('N', 'G'), { source: 'agent', from: 'Agent X', text: 'found a thing' }, 500);
    expect(p.injections).toHaveLength(1);
    expect(p.injections[0]).toMatchObject({ source: 'agent', from: 'Agent X', text: 'found a thing', time: 500 });
  });

  it('ignores blank text', () => {
    const p = createProject('N', 'G');
    expect(injectInfo(p, { source: 'user', from: 'you', text: '   ' })).toBe(p);
  });

  it('consumeInjections returns the pending injections oldest first and marks them consumed', () => {
    let p = createProject('N', 'G');
    p = injectInfo(p, { source: 'user', from: 'you', text: 'first' }, 1);
    p = injectInfo(p, { source: 'user', from: 'you', text: 'second' }, 2);
    const { project, injected } = consumeInjections(p);
    expect(injected.map((i) => i.text)).toEqual(['first', 'second']);
    expect(project.injections.every((i) => i.consumedTurn === project.turn)).toBe(true);
  });

  it('a second consume returns none', () => {
    let p = createProject('N', 'G');
    p = injectInfo(p, { source: 'user', from: 'you', text: 'first' });
    const { project } = consumeInjections(p);
    expect(consumeInjections(project).injected).toEqual([]);
  });
});

describe('pruneProjects', () => {
  it('keeps unfinished projects ahead of finished ones and caps at the limit', () => {
    const base = createProject('N', 'G');
    const open1: Project = { ...base, id: 'o1', state: 'working', updatedAt: 5 };
    const open2: Project = { ...base, id: 'o2', state: 'testing', updatedAt: 15 };
    const done1: Project = { ...base, id: 'f1', state: 'complete', updatedAt: 30 };
    const done2: Project = { ...base, id: 'f2', state: 'failed', updatedAt: 10 };
    const result = pruneProjects([done1, open1, done2, open2], 3);
    expect(result.map((p) => p.id)).toEqual(['o2', 'o1', 'f1']);
  });
});

describe('isProject', () => {
  it('accepts createProject output after a JSON round trip', () => {
    const p = JSON.parse(JSON.stringify(createProject('N', 'Goal')));
    expect(isProject(p)).toBe(true);
  });

  it('rejects a project with an unknown state', () => {
    const p = { ...createProject('N', 'Goal'), state: 'bogus' };
    expect(isProject(p)).toBe(false);
  });
});
