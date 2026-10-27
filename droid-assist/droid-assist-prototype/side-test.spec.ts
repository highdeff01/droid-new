import { describe, expect, it, vi } from 'vitest';
import type { ActionRecord, WorkflowStep } from './types.js';
import { createBudget } from './safety.js';
import { busFeedback, findingsToNotes, guardCheck, runSideTest, sentinelScan, type GuardState, type SentinelAlert, type SideTestDeps, type SideTestPlan } from './side-test.js';

const step = (name: string, x: number, y: number, extra: Partial<WorkflowStep> = {}): WorkflowStep => ({ id: name, name, action: 'drag', x, y, status: 'pending', ...extra });
const experiment = step('nudge character', 0.4, 0.5, { endX: 0.5, endY: 0.5 });
const main = step('walk to door', 0.4, 0.5, { endX: 0.8, endY: 0.5 });
/** The real drag the bridge performed for the experiment, in native pixels of a 1000x500 screen. */
const dragRecord: ActionRecord = { id: 'a1', time: 0, action: 'drag', x: 400, y: 250, endX: 500, endY: 250, srcW: 1000, srcH: 500, source: 'Side test', via: 'bridge', ok: true, message: 'ok' };

function deps(over: Partial<SideTestDeps> & { state?: Partial<GuardState> } = {}) {
  const state: GuardState = { aborted: false, armed: true, stageOn: true, ...over.state };
  const calls: string[] = [];
  const base: SideTestDeps = {
    guard: () => state,
    budget: createBudget(10),
    switchTo: async (t) => (calls.push(`switch:${t || 'main'}`), { ok: true, message: `on ${t || 'main app'}` }),
    act: async (s, dryRun) => (calls.push(`act:${s.name}${dryRun ? ':dry' : ''}`), { ok: true, message: `${s.name} done`, record: !dryRun && s === experiment ? dragRecord : undefined }),
    capture: async () => (calls.push('capture'), 'character one tile right'),
    research: async (q) => (calls.push(`research:${q}`), [`wiki: ${q} uses arrow keys`]),
    sentinels: async () => [],
    onAlert: vi.fn(),
    log: () => {},
  };
  return { d: { ...base, ...over }, calls, state };
}

describe('guardCheck', () => {
  it('stops on abort, skips with the stage off, dry-runs disarmed and halts on an empty budget', () => {
    const budget = createBudget(1);
    expect(guardCheck({ aborted: true, armed: true, stageOn: true }, budget)).toMatchObject({ go: false, status: 'aborted' });
    expect(guardCheck({ aborted: false, armed: true, stageOn: false }, budget)).toMatchObject({ go: false, status: 'skipped' });
    expect(guardCheck({ aborted: false, armed: false, stageOn: true }, budget)).toEqual({ go: true, dryRun: true });
    expect(budget.used).toBe(0);
    expect(guardCheck({ aborted: false, armed: true, stageOn: true }, budget)).toEqual({ go: true, dryRun: false });
    expect(guardCheck({ aborted: false, armed: true, stageOn: true }, budget)).toMatchObject({ go: false, status: 'halted' });
  });
});

describe('runSideTest lifecycle', () => {
  it('background: experiment → capture → backtrack → main without switching focus', async () => {
    const { d, calls } = deps();
    const plan: SideTestPlan = { name: 'move test', target: 'Game', mode: 'background', experiment, main };
    const r = await runSideTest(plan, d);
    expect(r.status).toBe('passed');
    expect(calls).toEqual(['act:nudge character', 'capture', 'act:Reverse: drag back to start', 'act:walk to door']);
    expect(r.phases.map((p) => p.phase)).toEqual(['experiment', 'capture', 'backtrack', 'main']);
    expect(r.findings).toEqual(['After "nudge character": character one tile right']);
    expect(d.budget.used).toBe(3);
    expect(r.at).toEqual({ x: 0.4, y: 0.5 });
  });

  it('foreground: switches to the side target and back around the experiment', async () => {
    const { d, calls } = deps();
    const r = await runSideTest({ name: 'fg', target: 'Browser', mode: 'foreground', research: 'level map', experiment, main }, d);
    expect(r.status).toBe('passed');
    expect(calls).toEqual(['switch:Browser', 'research:level map', 'act:nudge character', 'capture', 'act:Reverse: drag back to start', 'switch:main', 'act:walk to door']);
    expect(r.phases.map((p) => p.phase)).toEqual(['switch', 'research', 'experiment', 'capture', 'backtrack', 'return', 'main']);
  });

  it('research-only test stores findings without any action', async () => {
    const { d, calls } = deps();
    const r = await runSideTest({ name: 'look up', target: '', mode: 'background', research: 'boss pattern' }, d);
    expect(calls).toEqual(['research:boss pattern']);
    expect(r.status).toBe('passed');
    expect(findingsToNotes(r)).toEqual([{ kind: 'opportunity', text: '[Side test "look up"] wiki: boss pattern uses arrow keys' }]);
  });

  it('disarmed runs every action as a dry run and has nothing real to backtrack', async () => {
    const { d, calls } = deps({ state: { armed: false } });
    const r = await runSideTest({ name: 'dry', target: '', mode: 'background', experiment, main }, d);
    expect(r).toMatchObject({ status: 'passed', dryRun: true });
    expect(calls).toEqual(['act:nudge character:dry', 'capture', 'act:walk to door:dry']);
    expect(r.phases.find((p) => p.phase === 'backtrack')?.message).toContain('dry run');
    expect(d.budget.used).toBe(0);
  });

  it('stops at once when the kill switch fires mid-test', async () => {
    const { d, calls, state } = deps();
    d.capture = async () => {
      state.aborted = true;
      return 'x';
    };
    const r = await runSideTest({ name: 'abort', target: '', mode: 'background', experiment, main }, d);
    expect(r.status).toBe('aborted');
    expect(calls).toEqual(['act:nudge character']);
  });

  it('halts when the budget runs out and skips when the stage is off', async () => {
    const a = deps({ budget: createBudget(1) });
    expect((await runSideTest({ name: 'b', target: '', mode: 'background', experiment, main }, a.d)).status).toBe('halted');
    expect(a.calls).toEqual(['act:nudge character', 'capture']);
    const b = deps({ state: { stageOn: false } });
    expect((await runSideTest({ name: 's', target: '', mode: 'background', experiment }, b.d)).status).toBe('skipped');
    expect(b.calls).toEqual([]);
  });

  it('fails when the experiment fails, and forwards urgent sentinel alerts for auto-acting', async () => {
    const alert: SentinelAlert = { kind: 'notification', text: 'Notification: low health', urgent: true };
    const { d } = deps({ act: async () => ({ ok: false, message: 'bridge refused' }), sentinels: async () => [alert] });
    const r = await runSideTest({ name: 'f', target: '', mode: 'background', experiment }, d);
    expect(r.status).toBe('failed');
    expect(d.onAlert).toHaveBeenCalledWith(alert);
    expect(findingsToNotes(r)).toEqual([{ kind: 'unusual', text: '[Side test "f" sentinel] Notification: low health' }]);
    expect(busFeedback(r).name).toMatch(/^\[Side test\] "f" \(background\) failed: experiment failed — bridge refused; 0 finding\(s\), 1 sentinel alert\(s\)$/);
  });
});

describe('sentinelScan', () => {
  it('flags moved and missing elements and every notification', () => {
    const before = [{ name: 'Health bar', x: 0.1, y: 0.1 }, { name: 'Map', x: 0.9, y: 0.1 }, { name: 'Coins', x: 0.5, y: 0.05 }];
    const after = [{ name: 'health bar', x: 0.1, y: 0.2 }, { name: 'Coins', x: 0.505, y: 0.05 }];
    const alerts = sentinelScan(before, after, ['Enemy nearby', ' ']);
    expect(alerts.map((a) => [a.kind, a.urgent])).toEqual([['moved', false], ['missing', true], ['notification', true]]);
    expect(alerts[0].text).toContain('"Health bar" moved 10.0%');
  });
});
