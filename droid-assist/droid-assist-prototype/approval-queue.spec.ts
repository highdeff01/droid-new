import { describe, expect, it } from 'vitest';
import type { PlannedStep } from './project.js';
import { EMPTY_APPROVALS, SAFE_ACTIONS, decide, enqueue, isPreApproved, pendingFor, type ApprovalState } from './approval-queue.js';

const step = (id: string, patch: Partial<PlannedStep> = {}): PlannedStep => ({ id, name: `Step ${id}`, action: 'click', x: 0.1, y: 0.1, ...patch });

describe('isPreApproved', () => {
  it('passes every safe action', () => {
    for (const action of SAFE_ACTIONS) expect(isPreApproved(EMPTY_APPROVALS, step('s', { action }))).toBe(true);
  });

  it('a click is not pre-approved until the same action+target was approved once', () => {
    const s = step('s', { action: 'click', target: 'OK button' });
    expect(isPreApproved(EMPTY_APPROVALS, s)).toBe(false);
    const { state } = enqueue(EMPTY_APPROVALS, 'p1', [s]);
    const decided = decide(state, state.queue[0].id, { kind: 'approve' }, 'ctx')!;
    expect(isPreApproved(decided.state, s)).toBe(true);
  });

  it('a learned method matches the same target case-insensitively', () => {
    const s = step('s', { action: 'click', target: 'OK Button' });
    const { state } = enqueue(EMPTY_APPROVALS, 'p1', [s]);
    const decided = decide(state, state.queue[0].id, { kind: 'approve' }, 'ctx')!;
    expect(isPreApproved(decided.state, step('s2', { action: 'click', target: 'ok  button' }))).toBe(true);
  });
});

describe('enqueue', () => {
  it('queues only steps outside the pre-approved bounds', () => {
    const safe = step('safe', { action: 'move' });
    const risky = step('risky', { action: 'click', target: 'Delete' });
    const { queued } = enqueue(EMPTY_APPROVALS, 'p1', [safe, risky]);
    expect(queued.map((r) => r.step.id)).toEqual(['risky']);
  });

  it('does not double-queue the same step id for a project', () => {
    const risky = step('risky', { action: 'click', target: 'Delete' });
    const first = enqueue(EMPTY_APPROVALS, 'p1', [risky]);
    const second = enqueue(first.state, 'p1', [risky]);
    expect(second.queued).toEqual([]);
    expect(pendingFor(second.state, 'p1')).toHaveLength(1);
  });

  it('pendingFor filters per project', () => {
    const risky = step('risky', { action: 'click', target: 'Delete' });
    const { state } = enqueue(EMPTY_APPROVALS, 'p1', [risky]);
    const { state: state2 } = enqueue(state, 'p2', [step('other', { action: 'click', target: 'Other' })]);
    expect(pendingFor(state2, 'p1').map((r) => r.step.id)).toEqual(['risky']);
    expect(pendingFor(state2, 'p2').map((r) => r.step.id)).toEqual(['other']);
    expect(pendingFor(state2)).toHaveLength(2);
  });
});

describe('decide', () => {
  const queued = (): { state: ApprovalState; id: string; step: PlannedStep } => {
    const s = step('risky', { action: 'click', target: 'Delete' });
    const { state } = enqueue(EMPTY_APPROVALS, 'p1', [s]);
    return { state, id: state.queue[0].id, step: s };
  };

  it('approve returns the step, adds a learned method and a success habit with an add lesson and pattern', () => {
    const { state, id, step: s } = queued();
    const result = decide(state, id, { kind: 'approve' }, 'ctx')!;
    expect(result.step).toEqual(s);
    expect(result.state.learned).toHaveLength(1);
    expect(result.habit).toMatchObject({ success: true, add: expect.stringContaining('approved') });
    expect(result.pattern.kind).toBe('add');
  });

  it('edit returns the edited step with the original id and status edited', () => {
    const { state, id } = queued();
    const edited = step('ignored-id', { action: 'click', target: 'Delete', x: 0.5, y: 0.5 });
    const result = decide(state, id, { kind: 'edit', step: edited }, 'ctx')!;
    expect(result.step).toMatchObject({ id: 'risky', x: 0.5, y: 0.5 });
    expect(result.request.status).toBe('edited');
    expect(result.state.learned).toHaveLength(1);
  });

  it('reject returns a null step, a failure habit with an avoid lesson and avoid pattern, and no learned method', () => {
    const { state, id } = queued();
    const result = decide(state, id, { kind: 'reject' }, 'ctx')!;
    expect(result.step).toBeNull();
    expect(result.habit).toMatchObject({ success: false, avoid: expect.stringContaining('rejected') });
    expect(result.pattern.kind).toBe('avoid');
    expect(result.state.learned).toEqual([]);
  });

  it('deciding the same request twice returns null the second time', () => {
    const { state, id } = queued();
    const first = decide(state, id, { kind: 'approve' }, 'ctx')!;
    expect(decide(first.state, id, { kind: 'approve' }, 'ctx')).toBeNull();
  });

  it('deciding an unknown id returns null', () => {
    const { state } = queued();
    expect(decide(state, 'no-such-id', { kind: 'approve' }, 'ctx')).toBeNull();
  });
});
