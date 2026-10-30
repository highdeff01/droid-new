import { afterEach, describe, expect, it, vi } from 'vitest';
import { planSegments, planRouteSegments, reaim, runLiveDrag, trackWaypoints, SWARM_SIZE, type DragInput, type DragIntervention, type LiveDragDeps } from './drag-swarm.js';
import { pointerAction, sendNative } from './bridge.js';

const W = 320;
const H = 180;

/** Deterministic noise, so every 16×16 patch is unique and a template search finds it exactly. */
function noise(seed: number): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  let s = seed;
  for (let i = 0; i < data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    data[i] = data[i + 1] = data[i + 2] = s & 0xff;
    data[i + 3] = 255;
  }
  return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}

/** `img` with its content moved by (dx, dy) pixels. */
function shifted(img: ImageData, dx: number, dy: number): ImageData {
  const data = new Uint8ClampedArray(img.data.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = Math.min(W - 1, Math.max(0, x - dx));
      const sy = Math.min(H - 1, Math.max(0, y - dy));
      data.set(img.data.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * W + x) * 4);
    }
  }
  return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}

const ref = noise(7);
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.004);

/** A sender that records every input and answers ok unless told otherwise. */
function sender(fail: DragInput | null = null) {
  const sent: Array<{ input: DragInput; x: number; y: number }> = [];
  const send = vi.fn(async (input: DragInput, p: { x: number; y: number }) => {
    sent.push({ input, ...p });
    return input === fail ? { ok: false, message: 'PC failed' } : { ok: true, message: 'done' };
  });
  return { sent, send };
}

function drag(patch: Partial<LiveDragDeps> = {}) {
  const { sent, send } = sender();
  const deps: LiveDragDeps = { start: { x: 0.2, y: 0.3 }, end: { x: 0.8, y: 0.6 }, ref, send, live: () => ref, halt: () => null, intervention: () => null, ...patch };
  return { deps, sent };
}

afterEach(() => vi.unstubAllGlobals());

describe('planSegments', () => {
  it('splits the path into 12 coordinate agents ending at the drop point', () => {
    const agents = planSegments({ x: 0, y: 0 }, { x: 0.6, y: 0.3 });
    expect(agents).toHaveLength(SWARM_SIZE);
    expect(SWARM_SIZE).toBeGreaterThanOrEqual(10);
    expect(agents[0].point.x).toBeCloseTo(0.05);
    expect(agents[5]).toMatchObject({ t: 0.5, point: { x: 0.3, y: 0.15 } });
    expect(agents[11].point).toEqual({ x: 0.6, y: 0.3 });
  });
});

describe('trackWaypoints: parallel live correction', () => {
  it('moves every waypoint by the drift its own region shows on the live frame', () => {
    const agents = planSegments({ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.6 });
    const out = trackWaypoints(ref, shifted(ref, 8, -4), agents);
    expect(out.lost).toBe(false);
    out.agents.forEach((a, i) => {
      close(a.point.x, agents[i].planned.x + 8 / W);
      close(a.point.y, agents[i].planned.y - 4 / H);
    });
  });

  it('an unchanged screen keeps the planned path', () => {
    const agents = planSegments({ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.6 });
    expect(trackWaypoints(ref, ref, agents).agents.map((a) => a.point)).toEqual(agents.map((a) => a.planned));
  });

  it('flags the drop point lost when its region is nowhere near', () => {
    const out = trackWaypoints(ref, noise(99), planSegments({ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.6 }));
    expect(out.lost).toBe(true);
    expect(out.agents[11].point).toEqual({ x: 0.7, y: 0.6 });
  });
});

describe('obstacle-aware routes', () => {
  it('routes drag waypoints around a detected popup box', () => {
    const agents = planRouteSegments({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, 12, [{ x: 0.4, y: 0.3, w: 0.2, h: 0.4 }]);
    expect(agents.some((a) => a.point.y <= 0.288 || a.point.y >= 0.712)).toBe(true);
    for (const a of agents) expect(a.point.x <= 0.388 || a.point.x >= 0.612 || a.point.y <= 0.288 || a.point.y >= 0.712).toBe(true);
    const dragged = drag({ avoidBoxes: () => [{ x: 0.4, y: 0.3, w: 0.2, h: 0.4 }] });
    return runLiveDrag(dragged.deps).then((out) => {
      expect(out.ok).toBe(true);
      expect(out.path.some((p) => p.y <= 0.288 || p.y >= 0.712)).toBe(true);
    });
  });

  it('does not press or continue when the pointer starts inside an avoid region', async () => {
    const { deps, sent } = drag({ avoidBoxes: () => [{ x: 0.1, y: 0.2, w: 0.2, h: 0.2 }] });
    const out = await runLiveDrag(deps);
    expect(out).toMatchObject({ ok: false, pressed: false, halted: true });
    expect(out.message).toMatch(/no input dispatched/);
    expect(sent).toEqual([]);
  });
});

describe('reaim', () => {
  it('re-plans only the agents still ahead, from the current point to the new drop point', () => {
    const agents = planSegments({ x: 0, y: 0 }, { x: 1, y: 0 }, 4);
    const next = reaim(agents, 2, { x: 0.5, y: 0 }, { x: 0.5, y: 1 });
    expect(next.slice(0, 2)).toEqual(agents.slice(0, 2));
    expect(next[2].point).toEqual({ x: 0.5, y: 0.5 });
    expect(next[3].point).toEqual({ x: 0.5, y: 1 });
  });
});

describe('runLiveDrag', () => {
  it('presses, moves through every corrected waypoint and releases at the drop point', async () => {
    const { deps, sent } = drag({ live: () => shifted(ref, 8, 0) });
    const out = await runLiveDrag(deps);
    expect(out.ok).toBe(true);
    expect(sent.map((s) => s.input)).toEqual(['mouse_down', ...Array(SWARM_SIZE).fill('move'), 'mouse_up']);
    expect(sent[0]).toMatchObject({ x: 0.2, y: 0.3 });
    close(sent[SWARM_SIZE].x, 0.8 + 8 / W);
    expect(out.releasedAt).toEqual(out.path[out.path.length - 1]);
  });

  it('re-tracks on every segment as the screen keeps changing', async () => {
    let frame = 0;
    const { deps, sent } = drag({ live: () => shifted(ref, 2 * frame++, 0) });
    await runLiveDrag(deps);
    const moves = sent.filter((s) => s.input === 'move');
    close(moves[0].x, deps.start.x + 0.05 + 0);
    close(moves[5].x, deps.start.x + 0.3 + 10 / W);
    close(moves[11].x, 0.8 + 22 / W);
  });

  it('a halt (stop plan, abort, disarm) mid-drag releases the mouse where it is and sends nothing more', async () => {
    let n = 0;
    const { deps, sent } = drag({ halt: () => (++n > 3 ? 'Plan stopped' : null) });
    const out = await runLiveDrag(deps);
    expect(out).toMatchObject({ ok: false, halted: true });
    expect(out.message).toMatch(/Plan stopped — released after 3 of 12/);
    expect(sent.map((s) => s.input)).toEqual(['mouse_down', 'move', 'move', 'move', 'mouse_up']);
    expect(sent[4]).toMatchObject({ x: sent[3].x, y: sent[3].y });
  });

  it('the user can re-aim the drop point mid-drag, then release at once', async () => {
    const asks: Array<DragIntervention | null> = [null, null, { kind: 'aim', point: { x: 0.1, y: 0.9 } }];
    const { deps, sent } = drag({ intervention: () => asks.shift() ?? null });
    const out = await runLiveDrag(deps);
    expect(out.ok).toBe(true);
    expect(out.releasedAt).toEqual({ x: 0.1, y: 0.9 });
    expect(sent[sent.length - 1]).toMatchObject({ input: 'mouse_up', x: 0.1, y: 0.9 });

    const release: Array<DragIntervention | null> = [null, { kind: 'release' }];
    const second = drag({ intervention: () => release.shift() ?? null });
    const stopped = await runLiveDrag(second.deps);
    expect(stopped).toMatchObject({ ok: false, halted: true });
    expect(second.sent.map((s) => s.input)).toEqual(['mouse_down', 'move', 'mouse_up']);
  });

  it('a lost drop point asks the main AI once and follows its relocation', async () => {
    const relocate = vi.fn(async () => ({ x: 0.5, y: 0.1 }));
    const { deps } = drag({ live: () => noise(42), relocate });
    const out = await runLiveDrag(deps);
    expect(relocate).toHaveBeenCalledTimes(1);
    expect(out.releasedAt).toEqual({ x: 0.5, y: 0.1 });
  });

  it('a failed move releases the button; a failed press sends nothing else', async () => {
    const moveFail = sender('move');
    const out = await runLiveDrag({ ...drag().deps, send: moveFail.send });
    expect(out.message).toMatch(/Segment 1 move failed/);
    expect(moveFail.sent.map((s) => s.input)).toEqual(['mouse_down', 'move', 'mouse_up']);
    const downFail = sender('mouse_down');
    const pressed = await runLiveDrag({ ...drag().deps, send: downFail.send });
    expect(pressed).toMatchObject({ ok: false, pressed: false });
    expect(downFail.sent.map((s) => s.input)).toEqual(['mouse_down']);
  });
});

describe('live drag native input', () => {
  it('maps a segment input to native pixels on the display origin', () => {
    expect(pointerAction('mouse_down', { x: 0.5, y: 0.25 }, 1000, 800, { x: 1920, y: 0 })).toEqual({ action: 'mouse_down', x: 2420, y: 200, delayMs: 0 });
    expect(pointerAction('move', { x: 0.1, y: 0.1 }, 1000, 800)).toMatchObject({ action: 'move', x: 100, y: 80, durationMs: 40 });
  });

  it('sends one segment through POST /api/replay and succeeds only once the PC completed it', async () => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ success: true, run: { id: 'r', status: 'running' } })).mockResolvedValue(json({ success: true, run: { id: 'r', status: 'completed' } }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await sendNative('http://pc', { id: 'seg', name: 'Live drag' }, [pointerAction('mouse_up', { x: 0.5, y: 0.5 }, 1000, 800)], { pollMs: 1 });
    expect(out.ok).toBe(true);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).steps).toEqual([expect.objectContaining({ action: 'mouse_up', x: 500, y: 400 })]);
  });
});
