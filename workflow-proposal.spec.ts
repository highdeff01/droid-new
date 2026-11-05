import { describe, expect, it } from 'vitest';
import type { InitiativeProposal, WorkflowPack } from './initiative.js';
import type { SavedCard, WorkflowStep } from './types.js';
import { packCard, packProposal, verifyPack, workflowCandidate, type StepCheck } from './workflow-proposal.js';

const step = (id: string, action: WorkflowStep['action'] = 'click'): WorkflowStep => ({ id, name: `Step ${id}`, action, x: 0.5, y: 0.5, status: 'done' });
const card = (id: string, name: string, steps: WorkflowStep[] = [step('a')]): SavedCard => ({ id, name, description: '', savedAt: 0, steps });
const pendingPack = (id: string, name: string): InitiativeProposal => ({ id, time: 0, category: 'workflow', text: '', status: 'pending', pack: { name, description: '', steps: [step('a')], checks: [] } });
const pack = (steps: WorkflowStep[] = [step('a'), step('b')]): WorkflowPack => ({ name: 'Open the calculator', description: 'opens the calculator', steps, checks: [] });

describe('workflowCandidate', () => {
  it('returns a name/description/steps for a new run, with steps pending and stripped of refFrame', () => {
    const steps = [{ ...step('a'), refFrame: { id: 1, url: 'x' } as unknown as WorkflowStep['refFrame'] }];
    const candidate = workflowCandidate('open calculator', steps, [], []);
    expect(candidate).toMatchObject({ name: expect.any(String), description: expect.any(String) });
    expect(candidate!.steps[0]).toMatchObject({ id: 'a', status: 'pending' });
    expect(candidate!.steps[0].refFrame).toBeUndefined();
  });

  it('is null for a run with no steps', () => {
    expect(workflowCandidate('open calculator', [], [], [])).toBeNull();
  });

  it('is null when a saved card is already similar', () => {
    const steps = [step('a')];
    const similar = card('c1', 'Open calculator app', [step('a')]);
    expect(workflowCandidate('open calculator app', steps, [similar], [])).toBeNull();
  });

  it('is null when a pending workflow proposal pack is already similar', () => {
    const steps = [step('a')];
    expect(workflowCandidate('open calculator app', steps, [], [pendingPack('p1', 'Open calculator app')])).toBeNull();
  });

  it('is not blocked by a dismissed similar proposal', () => {
    const steps = [step('a')];
    const dismissed: InitiativeProposal = { ...pendingPack('p1', 'Open calculator app'), status: 'dismissed' };
    expect(workflowCandidate('open calculator app', steps, [], [dismissed])).not.toBeNull();
  });
});

describe('verifyPack', () => {
  const okCheck: StepCheck = async () => ({ ok: true, message: 'clicked' });

  it('is verified with one PASS line per step when every check passes', async () => {
    const { verified, pack: result } = await verifyPack(pack(), okCheck);
    expect(verified).toBe(true);
    expect(result.checks).toEqual(['PASS "Step a" — clicked', 'PASS "Step b" — clicked']);
  });

  it('stops at the first failing step, never checking later steps, with a FAIL line last', async () => {
    let calls = 0;
    const check: StepCheck = async (s) => {
      calls++;
      return s.id === 'a' ? { ok: true, message: 'clicked' } : { ok: false, message: 'not found' };
    };
    const { verified, pack: result } = await verifyPack(pack([step('a'), step('b'), step('c')]), check);
    expect(verified).toBe(false);
    expect(calls).toBe(2);
    expect(result.checks).toEqual(['PASS "Step a" — clicked', 'FAIL "Step b" — not found']);
  });
});

describe('packProposal', () => {
  it('is a workflow category proposal naming the pack and step count, carrying the pack', () => {
    const p = packProposal(pack());
    expect(p.category).toBe('workflow');
    expect(p.text).toContain('Open the calculator');
    expect(p.text).toContain('2');
    expect(p.pack!.name).toBe('Open the calculator');
  });
});

describe('packCard', () => {
  it('is a SavedCard with a new id, the pack name/description and pending steps', () => {
    const c = packCard(pack(), 50);
    expect(c.id).not.toBe('');
    expect(c).toMatchObject({ name: 'Open the calculator', description: 'opens the calculator', savedAt: 50 });
    expect(c.steps.every((s) => s.status === 'pending')).toBe(true);
  });
});
