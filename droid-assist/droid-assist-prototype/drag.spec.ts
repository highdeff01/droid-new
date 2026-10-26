import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeActions, sendToBridge } from './bridge.js';
import { parsePlan } from './planner.js';
import { runStep, type StepDeps } from './run-step.js';
import { DEMO_ARCHIVE, DEMO_FILE, demoDrag, initialDemoFile } from './demo-desktop.js';
import { classifyGesture } from './gesture.js';
import { POINTER_ACTIONS, STEP_ACTIONS, type Frame, type WorkflowStep } from './types.js';

const W = 320;
const H = 180;
const blank = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4), colorSpace: 'srgb' } as ImageData;
const live: Frame = { id: 1, time: 0, url: 'shot', data: blank, srcW: 2000, srcH: 1000, source: 'desktop' };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const completedRun = () => vi.fn()
  .mockResolvedValueOnce(json({ success: true, run: { id: 'r', status: 'running' } }))
  .mockResolvedValue(json({ success: true, run: { id: 'r', status: 'completed' } }));

const drag = (patch: Partial<WorkflowStep> = {}): WorkflowStep => ({ id: 'd', name: 'Drag Report onto Archive', action: 'drag', x: 0.1, y: 0.1, endX: 0.9, endY: 0.5, status: 'pending', ...patch });

function deps(patch: Partial<StepDeps> = {}) {
  const lines: string[] = [];
  const d: StepDeps = { bridgeUrl: 'http://pc', capture: vi.fn(async () => live), attempts: 1, retryMs: 1, dispatch: true, log: (m) => lines.push(m), ...patch };
  return { d, lines };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('drag step contract', () => {
  it('is a pointer action in the planner contract', () => {
    expect(STEP_ACTIONS).toContain('drag');
    expect(POINTER_ACTIONS.has('drag')).toBe(true);
  });
});

describe('drag as native input', () => {
  it('is one pyautogui-style drag from the start to the end in native pixels with a humanized duration', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(nativeActions(drag(), 1000, 800)).toEqual([{ action: 'drag', x: 100, y: 80, endX: 900, endY: 400, durationMs: 250, delayMs: 200 }]);
    vi.spyOn(Math, 'random').mockReturnValue(1);
    expect(nativeActions(drag(), 2000, 1000)[0]).toMatchObject({ x: 200, y: 100, endX: 1800, endY: 500, durationMs: 550 });
  });

  it('starts at the drift-corrected point and keeps the end', () => {
    expect(nativeActions(drag({ correctedX: 0.2, correctedY: 0.3 }), 1000, 1000)[0]).toMatchObject({ x: 200, y: 300, endX: 900, endY: 500 });
  });

  it('is sent through POST /api/replay and reports both points', async () => {
    const fetchSpy = completedRun();
    vi.stubGlobal('fetch', fetchSpy);
    const out = await sendToBridge('http://pc', drag(), 1000, 800, { pollMs: 1 });
    expect(out.ok).toBe(true);
    expect(out.message).toMatch(/drag on the PC at \(100, 80\)px → \(900, 400\)px/);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://pc/api/replay');
    expect(JSON.parse(init.body).steps).toEqual([expect.objectContaining({ action: 'drag', x: 100, y: 80, endX: 900, endY: 400 })]);
  });

  it('refuses a drag without an end point instead of sending a zero-length drag', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const out = await sendToBridge('http://pc', drag({ endX: undefined, endY: undefined }), 1000, 800);
    expect(out.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('planned drag', () => {
  it('keeps both endpoints and both target descriptions', () => {
    const [s] = parsePlan('{"steps":[{"name":"Drag X onto Y","action":"drag","target":"file X","x":0.1,"y":0.2,"endTarget":"folder Y","endX":0.8,"endY":0.6}]}', null);
    expect(s).toMatchObject({ action: 'drag', target: 'file X', x: 0.1, y: 0.2, endTarget: 'folder Y', endX: 0.8, endY: 0.6 });
  });

  it('rejects a drag without an end point', () => {
    expect(() => parsePlan('{"steps":[{"name":"Drag","action":"drag","target":"file","x":0.1,"y":0.2}]}', null)).toThrow(/without an end point/);
  });

  it('a planned drag runs as a real drag through the bridge path', async () => {
    const [s] = parsePlan('{"steps":[{"name":"Drag X onto Y","action":"drag","target":"file X","x":0.25,"y":0.5,"endTarget":"folder Y","endX":0.75,"endY":0.25}]}', null);
    const fetchSpy = completedRun();
    vi.stubGlobal('fetch', fetchSpy);
    const confirm = vi.fn(async () => ({ visible: true, reason: 'file is there', thinking: null }));
    const { d } = deps({ grounding: { confirm, relocate: vi.fn(async () => null) } });
    const out = await runStep(s, d);
    expect(out).toMatchObject({ ok: true, executed: true });
    expect(confirm).toHaveBeenCalledWith(live, s, { x: 0.25, y: 0.5 });
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).steps[0]).toMatchObject({ action: 'drag', x: 500, y: 500, endX: 1500, endY: 250 });
  });
});

describe('runStep on a drag', () => {
  it('never dispatches when the start is rejected twice', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const confirm = vi.fn(async (_l: Frame, _s: WorkflowStep, _p: { x: number; y: number }) => ({ visible: false, reason: 'empty', thinking: null }));
    const { d } = deps({ grounding: { confirm, relocate: vi.fn(async () => ({ x: 0.3, y: 0.3 })) } });
    const out = await runStep(drag({ target: 'file X' }), d);
    expect(out.executed).toBe(false);
    expect(confirm.mock.calls.map((c) => c[2])).toEqual([{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an off-screen end point before capturing or dispatching', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { d } = deps();
    const out = await runStep(drag({ endX: 1.3 }), d);
    expect(out).toMatchObject({ ok: false, executed: false });
    expect(out.message).toMatch(/off-screen/);
    expect(d.capture).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a drag without an end point', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const out = await runStep(drag({ endY: undefined }), deps().d);
    expect(out.message).toMatch(/no end point/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts an end point on the screen edge', async () => {
    vi.stubGlobal('fetch', completedRun());
    const out = await runStep(drag({ endX: 1, endY: 0 }), deps().d);
    expect(out.executed).toBe(true);
  });
});

describe('demo desktop drag', () => {
  const file = { x: DEMO_FILE.x, y: DEMO_FILE.y };

  it('moves the file to the drop point', () => {
    const r = demoDrag(initialDemoFile(), file, { x: 0.4, y: 0.4 });
    expect(r).toMatchObject({ moved: true, file: { x: 0.4, y: 0.4, archived: false } });
  });

  it('files it when dropped on the Archive folder', () => {
    const r = demoDrag(initialDemoFile(), file, { x: DEMO_ARCHIVE.x + 0.05, y: DEMO_ARCHIVE.y + 0.05 });
    expect(r.file.archived).toBe(true);
    expect(r.message).toMatch(/Archive/);
  });

  it('grabs nothing when the drag does not start on the file', () => {
    const start = initialDemoFile();
    const r = demoDrag(start, { x: 0.3, y: 0.3 }, { x: 0.5, y: 0.5 });
    expect(r).toMatchObject({ moved: false, file: start });
  });
});

describe('recorder gesture', () => {
  it('is a click when the pointer barely moved and a drag otherwise', () => {
    expect(classifyGesture({ x: 0.1, y: 0.1 }, { x: 0.101, y: 0.1 }, 1000, 1000)).toBe('click');
    expect(classifyGesture({ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.3 }, 1000, 1000)).toBe('drag');
  });
});
