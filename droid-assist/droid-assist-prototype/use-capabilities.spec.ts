import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Frame, WorkflowStep } from './types.js';
import type { HabitOutcome } from './habits.js';
import { createBudget } from './safety.js';
import { createRegistry, invokeCapability, type Caller } from './capability-registry.js';
import { capabilities, type CapabilityDeps, type StepRun } from './use-capabilities.js';
import type { Presentation } from './presentation.js';
import type { SavedScript } from './script-op.js';
import type { KnowledgeEntry } from './video-notes.js';
import { useAssist } from './use-assist.js';

const pixels = (v: number) => ({ data: new Uint8ClampedArray(320 * 180 * 4).fill(v), width: 320, height: 180 }) as unknown as ImageData;
const frame = (v: number): Frame => ({ id: v, time: 0, url: `data:image/jpeg;base64,${'A'.repeat(40)}`, data: pixels(v), srcW: 1920, srcH: 1080, source: 'demo' });

function setup(over: Partial<CapabilityDeps> = {}) {
  const ran: Array<{ step: WorkflowStep; dryRun: boolean }> = [];
  const dry: WorkflowStep[] = [];
  const learned: HabitOutcome[][] = [];
  const toggled: string[] = [];
  const saved = { presentations: [] as Presentation[], scripts: [] as SavedScript[], knowledge: [] as KnowledgeEntry[] };
  const deps: CapabilityDeps = {
    runBriefed: vi.fn(async (_a: string, step: WorkflowStep, _b: unknown, dryRun: boolean): Promise<StepRun> => {
      ran.push({ step, dryRun });
      return { ok: true, executed: true, message: 'sent' };
    }),
    dryRun: vi.fn(async (_a: string, step: WorkflowStep): Promise<StepRun> => {
      dry.push(step);
      return { ok: step.text !== 'bad', executed: false, message: step.text === 'bad' ? 'target missing' : 'dry run ok' };
    }),
    newBudget: () => createBudget(10),
    armed: () => false,
    live: () => frame(0),
    ask: () => null,
    learn: (o) => learned.push(o),
    app: () => 'Notes',
    log: vi.fn(),
    stageOn: () => true,
    toggleStage: (id) => toggled.push(id),
    sleep: async () => {},
    ...over,
  };
  const stores = {
    scripts: () => saved.scripts,
    savePresentation: (p: Presentation) => saved.presentations.push(p),
    saveScripts: (l: SavedScript[]) => { saved.scripts = l; },
    saveKnowledge: (e: KnowledgeEntry) => saved.knowledge.push(e),
  };
  const reg = createRegistry(capabilities(deps, stores));
  const call = (id: string, params: Record<string, unknown>, caller: Caller = { kind: 'main' }) => invokeCapability(reg, caller, id, params, deps.stageOn);
  return { deps, reg, call, ran, dry, learned, toggled, saved };
}

describe('capabilities', () => {
  it('registers every capability with an id, declared params and an invoke function', () => {
    const { reg } = setup();
    expect([...reg.keys()].sort()).toEqual(['computer.control', 'flow.simulate', 'presentation.build', 'script.run', 'script.save', 'stage.toggle', 'video.watch']);
    for (const c of reg.values()) {
      expect(c.params.length).toBeGreaterThan(0);
      expect(typeof c.invoke).toBe('function');
    }
  });

  it('computer.control sends armed steps for bridge dispatch and disarmed steps as a dry run', async () => {
    const armed = setup({ armed: () => true });
    expect((await armed.call('computer.control', { action: 'scroll', target: 'page' })).ok).toBe(true);
    expect(armed.ran[0]).toMatchObject({ dryRun: false, step: { action: 'scroll', target: 'page' } });
    const disarmed = setup();
    await disarmed.call('computer.control', { action: 'key', text: 'Enter' }, { kind: 'agent', stage: 'supervisor' });
    expect(disarmed.ran[0].dryRun).toBe(true);
  });

  it('a refused real-input step is a failure, never a simulated success', async () => {
    const { call } = setup({ armed: () => true, runBriefed: async () => ({ ok: false, executed: false, halt: true, message: 'Real input disarmed — not sent' }) });
    const r = await call('computer.control', { action: 'click', x: 0.2, y: 0.3 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/halted.*disarmed/);
  });

  it('script.save stores a named script and script.run runs it through the briefed path', async () => {
    const s = setup();
    expect((await s.call('script.save', { name: 'Login', steps: [{ action: 'type', text: 'me' }, { action: 'key', text: 'Enter' }] })).ok).toBe(true);
    expect(s.saved.scripts.map((x) => x.name)).toEqual(['Login']);
    expect((await s.call('script.run', { name: 'login' })).ok).toBe(true);
    expect(s.ran.map((r) => r.step.action)).toEqual(['type', 'key']);
  });

  it('script.run refuses an out-of-bounds script without running anything', async () => {
    const s = setup();
    const r = await s.call('script.run', { steps: [{ action: 'drag' }] });
    expect(r.ok).toBe(false);
    expect(s.ran).toEqual([]);
  });

  it('flow.simulate dry-runs only and feeds outcomes into habits under the simulation context', async () => {
    const s = setup({ armed: () => true });
    const r = await s.call('flow.simulate', { steps: [{ action: 'type', text: 'ok' }, { action: 'type', text: 'bad' }, { action: 'wait' }] });
    expect(r.ok).toBe(false);
    expect(s.ran).toEqual([]);
    expect(s.dry).toHaveLength(2);
    expect(s.learned[0].map((o) => [o.context, o.success])).toEqual([['simulation:Notes', true], ['simulation:Notes', false]]);
  });

  it('presentation.build saves a done presentation only when every slide verifies', async () => {
    const s = setup();
    const good = await s.call('presentation.build', { name: 'Demo', slides: [{ title: 'Screen', notes: ['the home screen'], screenshot: true }, { title: 'Findings', research: ['3 sources'] }] });
    expect(good.ok).toBe(true);
    expect(s.saved.presentations[0].status).toBe('done');
    const bad = await s.call('presentation.build', { name: 'Thin', slides: [{ title: 'Empty' }] });
    expect(bad.ok).toBe(false);
    expect(s.saved.presentations[1].status).toBe('incomplete');
  });

  it('video.watch plays and pauses through media steps and saves timestamped notes of notable moments', async () => {
    const shots = [frame(0), frame(0), frame(255)];
    const s = setup({ live: () => shots.shift() ?? frame(255) });
    const r = await s.call('video.watch', { title: 'Talk', samples: 2, durationMs: 0 });
    expect(r.ok).toBe(true);
    expect(s.ran.map((x) => x.step.action)).toEqual(['media', 'media']);
    expect(s.saved.knowledge[0].notes).toHaveLength(1);
    expect(s.saved.knowledge[0].notes[0].screenshot).toMatch(/^data:image/);
  });

  it('agents can never toggle stages; the main AI can', async () => {
    const s = setup();
    expect((await s.call('stage.toggle', { stage: 'drift', on: false }, { kind: 'agent', stage: 'supervisor' })).ok).toBe(false);
    expect(s.toggled).toEqual([]);
    expect((await s.call('stage.toggle', { stage: 'drift', on: false })).ok).toBe(true);
    expect(s.toggled).toEqual(['drift']);
  });

  it('an agent whose own stage is off is refused', async () => {
    const s = setup({ stageOn: (id) => id !== 'supervisor' });
    const r = await s.call('computer.control', { action: 'wait' }, { kind: 'agent', stage: 'supervisor' });
    expect(r.ok).toBe(false);
    expect(s.ran).toEqual([]);
  });
});

describe('useAssist capabilities', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('/do <id> {json} invokes the capability for the main AI and persists the script', async () => {
    const { result } = renderHook(() => useAssist());
    act(() => result.current.setGoal('/do script.save {"name":"Greet","steps":[{"action":"type","text":"hi"}]}'));
    await act(() => result.current.submitInput());
    expect(result.current.scripts.map((s) => s.name)).toEqual(['Greet']);
    expect(JSON.parse(localStorage.getItem('droid-assist.scripts') ?? '[]')[0].name).toBe('Greet');
  });

  it('exposes the registry to agents through the permission-checked path', async () => {
    const { result } = renderHook(() => useAssist());
    const r = await act(() => result.current.invokeCapability({ kind: 'agent', stage: 'supervisor' }, 'stage.toggle', { stage: 'drift', on: false }));
    expect(r.ok).toBe(false);
    expect(result.current.settings.stages.drift).toBe(true);
  });
});
