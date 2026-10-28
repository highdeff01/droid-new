import { describe, expect, it } from 'vitest';
import { createProject, injectInfo, transition, type Project } from './project.js';
import { HOLD_RETRY_MS, isReady, mergeUpdate, nextReady } from './use-projects.js';

const NOW = 1_000_000;
const at = (p: Project, updatedAt: number): Project => ({ ...p, updatedAt });

describe('project scheduler', () => {
  it('skips finished projects and those waiting on approvals', () => {
    const p = createProject('A', 'goal');
    const done = transition(transition(p, 'follow-up', 'x'), 'complete', 'done');
    const waiting = transition(p, 'waiting-for-reply', 'approve');
    expect(isReady(done, 0, NOW)).toBe(false);
    expect(isReady(waiting, 1, NOW)).toBe(false);
    expect(isReady(waiting, 0, NOW)).toBe(true);
  });

  it('rests an on-hold project before restoring it', () => {
    const held = transition(createProject('A', 'goal'), 'on-hold', 'disarmed');
    expect(isReady(at(held, NOW - HOLD_RETRY_MS + 1), 0, NOW)).toBe(false);
    expect(isReady(at(held, NOW - HOLD_RETRY_MS), 0, NOW)).toBe(true);
  });

  it('gives turns round robin, wrapping to the first', () => {
    const [a, b, c] = ['A', 'B', 'C'].map((n) => createProject(n, `goal ${n}`));
    const none = () => 0;
    expect(nextReady([a, b, c], null, none, NOW)?.id).toBe(a.id);
    expect(nextReady([a, b, c], a.id, none, NOW)?.id).toBe(b.id);
    expect(nextReady([a, b, c], c.id, none, NOW)?.id).toBe(a.id);
    expect(nextReady([], null, none, NOW)).toBeNull();
  });

  it('keeps info injected while a turn was running', () => {
    const p = createProject('A', 'goal');
    const stored = injectInfo(p, { source: 'agent', from: 'Drift agent', text: 'found Save' });
    const next = transition(p, 'testing', 'planned');
    expect(mergeUpdate(stored, next).injections.map((i) => i.text)).toEqual(['found Save']);
    expect(mergeUpdate(p, next)).toBe(next);
  });
});
