import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowStep } from './types.js';
import type { AskFn } from './ai.js';
import { PACK_MOVE_LIMIT, PACK_TEST_LIMIT, addMove, appendTestResult, combinePacks, crossRunSelection, extractGoal, generateGoal, moveStep, newPack, packTestTasks, similarReport, withGoal, type WorkflowPack } from './packs.js';
import { loadPacks, savePacks } from './storage.js';
import { exportBackup, parseBackup } from './backup.js';

const step = (id: string, action: WorkflowStep['action'] = 'click', extra: Partial<WorkflowStep> = {}): WorkflowStep => ({ id, name: id, action, x: 0.25, y: 0.75, status: 'done', ...extra });
const packOf = (name: string, ids: string[], goal = ''): WorkflowPack => ({ ...newPack(name, goal), steps: ids.map((id) => step(id)) });

describe('pack recording', () => {
  it('records click, navigate, type, key, scroll and drag moves with their coordinates and screenshot, as pending steps', () => {
    let pack = newPack('Login', '');
    const frame = { id: 1 } as unknown as WorkflowStep['refFrame'];
    for (const [i, action] of (['click', 'move', 'type', 'key', 'scroll'] as const).entries()) pack = addMove(pack, step(`s${i}`, action, { refFrame: frame })).pack;
    expect(pack.steps.map((s) => s.action)).toEqual(['click', 'move', 'type', 'key', 'scroll']);
    expect(pack.steps.every((s) => s.status === 'pending' && s.x === 0.25 && s.y === 0.75 && s.refFrame === frame)).toBe(true);
  });

  it(`stops at ${PACK_MOVE_LIMIT} moves and refuses non-move actions`, () => {
    let pack = newPack('Cap', '');
    for (let i = 0; i < PACK_MOVE_LIMIT; i++) pack = addMove(pack, step(`m${i}`, 'drag', { endX: 0.5, endY: 0.5 })).pack;
    const sixth = addMove(pack, step('m6'));
    expect(sixth.added).toBe(false);
    expect(sixth.reason).toContain(`${PACK_MOVE_LIMIT} moves`);
    expect(sixth.pack.steps).toHaveLength(PACK_MOVE_LIMIT);
    expect(addMove(newPack('x', ''), step('c', 'calc')).added).toBe(false);
  });
});

describe('combining and cross-run', () => {
  const a = packOf('A', ['a1', 'a2'], 'open files');
  const b = packOf('B', ['b1', 'b2', 'b3'], 'goal: save the report.');

  it('combines packs into one uncapped workflow of copied steps, leaving the sources as they were', () => {
    const big = packOf('Big', ['x1', 'x2', 'x3', 'x4']);
    const combined = combinePacks([a, b, big], [big.id, a.id]);
    if ('error' in combined) throw new Error(combined.error);
    expect(combined.kind).toBe('combined');
    expect(combined.steps.map((s) => s.name)).toEqual(['a1', 'a2', 'x1', 'x2', 'x3', 'x4']);
    expect(combined.steps.some((s) => s.id === 'a1')).toBe(false);
    expect(a.steps).toHaveLength(2);
    expect(combinePacks([a], [a.id])).toEqual({ error: 'Select at least two packs to combine' });
  });

  it("joins the parts' goals, or leaves the goal for the AI when a part has none", () => {
    const both = combinePacks([a, b], [a.id, b.id]) as WorkflowPack;
    expect(both.goal).toBe('Open files then Save the report');
    const c = packOf('C', ['c1']);
    const partial = combinePacks([a, c], [a.id, c.id]) as WorkflowPack;
    expect(partial.goal).toBe('');
    expect(partial.goalSource).toBeNull();
  });

  it('moves a step between packs and refuses a full recorded target', () => {
    const moved = moveStep([a, b], 'b2', a.id);
    if ('error' in moved) throw new Error(moved.error);
    expect(moved.packs[0].steps.map((s) => s.id)).toEqual(['a1', 'a2', 'b2']);
    expect(moved.packs[1].steps.map((s) => s.id)).toEqual(['b1', 'b3']);
    const full = packOf('Full', ['f1', 'f2', 'f3', 'f4', 'f5']);
    expect(moveStep([a, full], 'a1', full.id)).toEqual({ error: `"Full" already holds ${PACK_MOVE_LIMIT} moves` });
  });

  it('cross-runs a selection of whole flows and single steps in pack order, each step once', () => {
    const run = crossRunSelection([a, b], { packIds: [a.id], stepIds: ['b3', 'a2', 'b1'] });
    expect(run.map((s) => s.id)).toEqual(['a1', 'a2', 'b1', 'b3']);
    expect(run.every((s) => s.status === 'pending')).toBe(true);
    expect(crossRunSelection([a, b], { packIds: [], stepIds: [] })).toEqual([]);
  });
});

describe('goal bar', () => {
  it("extracts the goal from the user's input", () => {
    expect(extractGoal('  Goal: open the settings page. ')).toBe('Open the settings page');
    expect(extractGoal('I want to please export the CSV!')).toBe('Export the CSV');
    expect(extractGoal('   ')).toBe('');
    expect(newPack('P', 'could you rename the file').goal).toBe('Rename the file');
    expect(newPack('P', 'could you rename the file').goalSource).toBe('input');
    expect(newPack('P', '').goalSource).toBeNull();
  });

  it('asks the AI for a goal from the steps when there is none, and marks an edit as user-made', async () => {
    let prompt = '';
    const ask: AskFn = async (req) => { prompt = req.prompt; return { content: '{"goal":" Archive the old invoices "}', thinking: null } as Awaited<ReturnType<AskFn>>; };
    expect(await generateGoal(ask, [step('Open archive', 'click', { target: 'Archive folder' })], null)).toBe('Archive the old invoices');
    expect(prompt).toContain('click "Archive folder" at (25.0%, 75.0%)');
    const empty: AskFn = async () => ({ content: '{"goal":""}', thinking: null }) as Awaited<ReturnType<AskFn>>;
    await expect(generateGoal(empty, [], null)).rejects.toThrow('no goal');
    expect(withGoal(newPack('P', ''), 'Edited goal', 'user').goalSource).toBe('user');
  });
});

describe('perform-similar report', () => {
  const plan = [step('Open menu', 'click', { target: 'Menu' }), step('Pick export', 'click', { target: 'Export item', x: 0.1, y: 0.2 })];

  it('is complete only when every planned step ran ok', () => {
    const r = similarReport(plan, [{ ok: true, message: 'ok' }, { ok: true, message: 'ok' }], true);
    expect(r).toEqual({ complete: true, message: 'Complete — 2 step(s) verified on the live screen (dry run)' });
  });

  it('names the failing step: position, action, target, coordinates and reason', () => {
    const r = similarReport(plan, [{ ok: true, message: 'ok' }, { ok: false, message: 'Target "Export item" not located', target: { x: 0.4, y: 0.6 } }], false);
    expect(r.complete).toBe(false);
    if (r.complete) return;
    expect(r.failing).toEqual({ index: 2, total: 2, name: 'Pick export', action: 'click', target: 'Export item', x: 0.4, y: 0.6, reason: 'Target "Export item" not located' });
    expect(r.message).toBe('Incomplete at step 2/2 "Pick export" — click "Export item" at (40.0%, 60.0%): Target "Export item" not located');
  });

  it('reports a step the run never reached, an empty plan and a planning failure as incomplete', () => {
    const stopped = similarReport(plan, [{ ok: true, message: 'ok' }], false);
    expect(!stopped.complete && stopped.failing?.reason).toContain('not run');
    expect(similarReport([], [], false).complete).toBe(false);
    const failed = similarReport([], [], false, 'AI unavailable');
    expect(failed).toEqual({ complete: false, message: 'Incomplete — no plan: AI unavailable', failing: null });
  });
});

describe('background tests', () => {
  it('makes one task per pack with steps, slicing the budget, and keeps the newest results', () => {
    const a = packOf('A', ['a1'], 'open a');
    const tasks = packTestTasks([a, packOf('Empty', []), packOf('B', ['b1'])], 5);
    expect(tasks.map((t) => [t.id, t.goal, t.budget])).toEqual([[a.id, 'Open a', 3], [expect.any(String), expect.stringContaining('click "b1"'), 2]]);
    let p = a;
    for (let i = 0; i < PACK_TEST_LIMIT + 2; i++) p = appendTestResult(p, { id: `t${i}`, time: i, status: 'pass', message: '', dry: true });
    expect(p.tests).toHaveLength(PACK_TEST_LIMIT);
    expect(p.tests[0].id).toBe(`t${PACK_TEST_LIMIT + 1}`);
  });
});

describe('pack persistence', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips packs through storage and the backup export', async () => {
    const pack = { ...packOf('Saved', ['s1'], 'open it'), tests: [{ id: 't1', time: 1, status: 'fail' as const, message: 'no', dry: true }] };
    savePacks([pack]);
    const [loaded] = await loadPacks();
    expect(loaded).toEqual({ ...pack, steps: [{ ...pack.steps[0], status: 'pending' }] });
    const backup = parseBackup(JSON.stringify(exportBackup(localStorage)));
    expect(Array.isArray(backup.stores.packs)).toBe(true);
  });
});
