import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowStep } from './types.js';
import type { AskFn } from './ai.js';
import { PACK_MOVE_LIMIT } from './packs.js';
import { PACK_TEST_INTERVAL_MS, usePacks, type PackDeps } from './use-packs.js';
import { loadPacks } from './storage.js';

const step = (id: string, action: WorkflowStep['action'] = 'click', extra: Partial<WorkflowStep> = {}): WorkflowStep => ({ id, name: id, action, x: 0.3, y: 0.6, status: 'pending', ...extra });
const reply = (content: string) => ({ content, thinking: null }) as Awaited<ReturnType<AskFn>>;

function setup(over: Partial<PackDeps> = {}) {
  const logs: Array<[string, string, string | undefined]> = [];
  const state = { recording: false };
  const deps: PackDeps = {
    addLog: (from, message, tone) => logs.push([from, message, tone]),
    goalInput: () => '',
    ask: () => async () => reply('{"goal":"Sort the files"}'),
    frame: () => null,
    plan: async () => [],
    runStep: async (s) => ({ ok: true, message: 'ok', target: { x: s.x, y: s.y } }),
    replay: vi.fn(async () => null),
    setRecording: (on) => {
      state.recording = on;
      hook.rerender();
    },
    armed: () => false,
    busy: () => false,
    stopped: () => false,
    resetStop: () => undefined,
    budget: () => 10,
    ...over,
  };
  const hook = renderHook(() => usePacks(deps, state.recording));
  return { hook, logs, deps, state };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('usePacks recording', () => {
  it(`records moves into the active pack, stops at ${PACK_MOVE_LIMIT} and asks the AI for a missing goal`, async () => {
    const { hook, state } = setup();
    let id = '';
    act(() => { id = hook.result.current.createPack('Files').id; });
    act(() => hook.result.current.toggleRecord(id));
    expect(state.recording).toBe(true);
    expect(hook.result.current.recordingPackId).toBe(id);
    for (let i = 0; i < PACK_MOVE_LIMIT + 1; i++) act(() => hook.result.current.capture(step(`s${i}`, i % 2 ? 'move' : 'click')));
    await act(async () => { await Promise.resolve(); });
    expect(state.recording).toBe(false);
    expect(hook.result.current.recordingPackId).toBeNull();
    const pack = hook.result.current.packs[0];
    expect(pack.steps.map((s) => s.id)).toEqual(['s0', 's1', 's2', 's3', 's4']);
    expect(pack.goal).toBe('Sort the files');
    expect(pack.goalSource).toBe('ai');
    expect((await loadPacks())[0].steps).toHaveLength(PACK_MOVE_LIMIT);
  });

  it("takes a new pack's goal from the input and lets the user edit it", () => {
    const { hook } = setup({ goalInput: () => 'Goal: open the inbox' });
    act(() => { hook.result.current.createPack('Mail'); });
    expect(hook.result.current.packs[0].goal).toBe('Open the inbox');
    act(() => hook.result.current.setGoal(hook.result.current.packs[0].id, 'Open the archive'));
    expect(hook.result.current.packs[0]).toMatchObject({ goal: 'Open the archive', goalSource: 'user' });
  });
});

describe('usePacks runs', () => {
  it('cross-runs only the selected steps and whole packs through the replay pipeline', async () => {
    const { hook, deps, state } = setup();
    const ids: string[] = [];
    for (const name of ['A', 'B']) {
      act(() => { ids.push(hook.result.current.createPack(name, `do ${name}`).id); });
      act(() => hook.result.current.toggleRecord(ids[ids.length - 1]));
      act(() => hook.result.current.capture(step(`${name}1`)));
      act(() => hook.result.current.capture(step(`${name}2`, 'type', { text: 'hi' })));
      act(() => deps.setRecording(false));
    }
    expect(state.recording).toBe(false);
    act(() => hook.result.current.selectPack(ids[1]));
    act(() => hook.result.current.selectStep('A2'));
    await act(() => hook.result.current.crossRun());
    expect(vi.mocked(deps.replay).mock.calls[0][0].map((s) => s.id)).toEqual(['A2', 'B1', 'B2']);
    act(() => hook.result.current.selectPack(ids[0]));
    act(() => hook.result.current.combine());
    expect(hook.result.current.packs[2]).toMatchObject({ kind: 'combined', name: 'A + B', goal: 'Do A then Do B' });
    act(() => hook.result.current.move('B1', ids[0]));
    expect(hook.result.current.packs[0].steps.map((s) => s.id)).toEqual(['A1', 'A2', 'B1']);
  });

  it('performs a similar action grounded on the live screen and shows the incomplete step in red', async () => {
    const plan = vi.fn(async (_goal: string, _context: string[]) => [step('Open menu', 'click', { target: 'Menu' }), step('Pick export', 'click', { target: 'Export' })]);
    const runStep = vi.fn<PackDeps['runStep']>(async (s) => (s.name === 'Pick export' ? { ok: false, message: 'Target "Export" not located', target: { x: 0.5, y: 0.25 } } : { ok: true, message: 'ok' }));
    const { hook, logs } = setup({ plan, runStep });
    let id = '';
    act(() => { id = hook.result.current.createPack('P', 'export').id; });
    act(() => hook.result.current.toggleRecord(id));
    act(() => hook.result.current.capture(step('rec1', 'click', { target: 'File menu' })));
    act(() => hook.result.current.selectStep('rec1'));
    await act(() => hook.result.current.performSimilar());
    expect(plan.mock.calls[0][1][0]).toContain('click "File menu"');
    expect(runStep.mock.calls.map((c) => [c[0].name, c[3]])).toEqual([['Open menu', true], ['Pick export', true]]);
    const r = hook.result.current.report!;
    expect(r.complete).toBe(false);
    expect(r.message).toBe('Incomplete at step 2/2 "Pick export" — click "Export" at (50.0%, 25.0%): Target "Export" not located');
    expect(logs).toContainEqual(['Perform similar', r.message, 'error']);
  });

  it('reports complete when every planned step ran', async () => {
    const { hook } = setup({ plan: async () => [step('Go')], armed: () => true });
    let id = '';
    act(() => { id = hook.result.current.createPack('P').id; });
    act(() => hook.result.current.toggleRecord(id));
    act(() => hook.result.current.capture(step('r')));
    act(() => hook.result.current.selectPack(id));
    await act(() => hook.result.current.performSimilar());
    expect(hook.result.current.report).toEqual({ complete: true, message: 'Complete — 1 step(s) performed' });
  });
});

describe('usePacks background tests', () => {
  it('tests every pack with steps in the background as a dry run and logs the result per pack', async () => {
    vi.useFakeTimers();
    const runStep = vi.fn<PackDeps['runStep']>(async (s) => (s.id === 'b1' ? { ok: false, message: 'not found' } : { ok: true, message: 'ok' }));
    const { hook, deps, logs } = setup({ runStep });
    const ids: string[] = [];
    for (const name of ['a', 'b']) {
      act(() => { ids.push(hook.result.current.createPack(name, `test ${name}`).id); });
      act(() => hook.result.current.toggleRecord(ids[ids.length - 1]));
      act(() => hook.result.current.capture(step(`${name}1`)));
      act(() => deps.setRecording(false));
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(PACK_TEST_INTERVAL_MS); });
    expect(runStep.mock.calls.every((c) => c[1] === 'Pack tester' && c[3] === true)).toBe(true);
    const [a, b] = hook.result.current.packs;
    expect(a.tests[0]).toMatchObject({ status: 'pass', dry: true });
    expect(b.tests[0]).toMatchObject({ status: 'fail', message: 'Step 1 "b1": not found' });
    expect(logs.filter((l) => l[0] === 'Pack tester').map((l) => l[2])).toEqual(['ok', 'error']);
  });
});
