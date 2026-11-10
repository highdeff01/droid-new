import { describe, expect, it } from 'vitest';
import type { Frame, WorkflowStep } from './types.js';
import { createWorkflowHandoff, restoreWorkflowHandoff, workflowStepFingerprint } from './workflow-handoff.js';

const frame = (id: number, time = id * 100): Frame => ({ id, time, url: '', data: {} as ImageData, srcW: 100, srcH: 100, source: 'desktop' });
const step = (id: string, patch: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id, name: `Step ${id}`, action: 'click', x: 0.2, y: 0.3, status: 'pending', ...patch,
});

describe('workflow handoff', () => {
  it('creates a compact snapshot and points at the first unverified step', () => {
    const steps = [
      step('a', { status: 'done', verifiedAt: 100, afterFrame: frame(7) }),
      step('b', { status: 'running' }),
      step('c'),
    ];
    const snapshot = createWorkflowHandoff('wf-1', 'Complete the report', steps, 'droid-new', 500);
    expect(snapshot).toMatchObject({
      version: 1, workflowId: 'wf-1', goal: 'Complete the report',
      createdAt: 500, fromController: 'droid-new', currentIndex: 1,
    });
    expect(snapshot.steps[0]).toMatchObject({ id: 'a', verifiedAt: 100, evidenceFrameId: 7 });
    expect(JSON.stringify(snapshot)).not.toContain('data:');
  });

  it('uses steps.length as the resume index when every step is verified', () => {
    const snapshot = createWorkflowHandoff('wf-1', 'goal', [
      step('a', { verifiedAt: 10, afterFrame: frame(1) }),
    ], 'droid-new');
    expect(snapshot.currentIndex).toBe(1);
  });

  it('inherits verified progress only when the matching post-action frame is still available', () => {
    const original = [
      step('a', { status: 'done', verifiedAt: 100, afterFrame: frame(7) }),
      step('b', { status: 'done' }),
      step('c', { status: 'running' }),
    ];
    const snapshot = createWorkflowHandoff('wf-1', 'goal', original, 'droid-new');
    const receiving = original.map((s) => ({ ...s, status: 'failed' as const }));
    const restored = restoreWorkflowHandoff(snapshot, 'wf-1', 'goal', receiving, new Set([7]));
    expect(restored.rejected).toBe(false);
    expect(restored.preservedVerified).toBe(1);
    expect(restored.resetUnverified).toBe(2);
    expect(restored.resumedIndex).toBe(1);
    expect(restored.steps.map((s) => s.status)).toEqual(['done', 'pending', 'pending']);
    expect(restored.steps[0].verifiedAt).toBe(100);
  });

  it('does not preserve a later verified step across a gap in the verified sequence', () => {
    const snapshot = createWorkflowHandoff('wf-1', 'goal', [
      step('a'),
      step('b', { status: 'done', verifiedAt: 200, afterFrame: frame(8) }),
    ], 'droid-new');
    const restored = restoreWorkflowHandoff(snapshot, 'wf-1', 'goal', [step('a'), step('b')], new Set([8]));
    expect(restored.steps.map((s) => s.status)).toEqual(['pending', 'pending']);
    expect(restored.preservedVerified).toBe(0);
    expect(restored.resumedIndex).toBe(0);
  });

  it('does not inherit completion when the post-action screenshot has expired', () => {
    const snapshot = createWorkflowHandoff('wf-1', 'goal', [
      step('a', { status: 'done', verifiedAt: 100, afterFrame: frame(7) }),
    ], 'droid-new');
    const restored = restoreWorkflowHandoff(snapshot, 'wf-1', 'goal', [step('a')], new Set());
    expect(restored.preservedVerified).toBe(0);
    expect(restored.steps[0]).toMatchObject({ status: 'pending', verifiedAt: undefined });
  });

  it('rejects a different workflow, goal, or step count instead of applying stale progress', () => {
    const snapshot = createWorkflowHandoff('wf-1', 'goal', [step('a')], 'droid-new');
    expect(restoreWorkflowHandoff(snapshot, 'wf-2', 'goal', [step('a')], new Set()).rejected).toBe(true);
    expect(restoreWorkflowHandoff(snapshot, 'wf-1', 'changed goal', [step('a')], new Set()).rejected).toBe(true);
    expect(restoreWorkflowHandoff(snapshot, 'wf-1', 'goal', [step('a'), step('b')], new Set()).rejected).toBe(true);
  });

  it('resets a step whose executable definition changed, even if its old evidence remains', () => {
    const snapshot = createWorkflowHandoff('wf-1', 'goal', [
      step('a', { status: 'done', verifiedAt: 100, afterFrame: frame(7) }),
    ], 'droid-new');
    const changed = step('a', { x: 0.9 });
    expect(workflowStepFingerprint(changed)).not.toBe(snapshot.steps[0].fingerprint);
    const restored = restoreWorkflowHandoff(snapshot, 'wf-1', 'goal', [changed], new Set([7]));
    expect(restored.steps[0].status).toBe('pending');
    expect(restored.steps[0].verifiedAt).toBeUndefined();
  });

  it('rejects snapshots that exceed the bounded step limit at creation', () => {
    expect(() => createWorkflowHandoff('wf-1', 'goal', Array.from({ length: 501 }, (_, i) => step(String(i))), 'agent'))
      .toThrow(/500 steps/);
  });
});
