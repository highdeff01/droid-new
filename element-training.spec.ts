import { describe, expect, it, vi } from 'vitest';
import type { Frame, WorkflowStep } from './types.js';
import type { MappedElement } from './element-map-studio.js';
import { TRAIN_EXPLORE, openedElements, trainElement, trainingStep, type TrainingDeps } from './element-training.js';

const W = 320;
const H = 180;

function image(rects: Array<[number, number, number, number]>): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.fill(255, (y * W + x) * 4, (y * W + x) * 4 + 3);
  return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}
const frame = (id: number, rects: Array<[number, number, number, number]>): Frame => ({ id, time: id, url: 'data:image/jpeg;base64,AA', data: image(rects), srcW: 1920, srcH: 1080, source: 'demo' });

const BUTTON: [number, number, number, number] = [20, 20, 60, 36];
const POPUP_LINKS: Array<[number, number, number, number]> = [[150, 60, 230, 72], [150, 90, 230, 102]];
const el: MappedElement = { id: 'e', name: 'Menu', box: { x: 20 / W, y: 20 / H, w: 40 / W, h: 16 / H }, mappedAt: 1 };

function deps(over: Partial<TrainingDeps> = {}) {
  const steps: WorkflowStep[] = [];
  const d: TrainingDeps = {
    perform: vi.fn(async (s: WorkflowStep) => {
      steps.push(s);
      return { ok: true, message: 'ok', shot: frame(steps.length + 1, [BUTTON, ...POPUP_LINKS]) };
    }),
    capture: vi.fn(async () => frame(1, [BUTTON])),
    research: vi.fn(async () => 'Opens the main menu.'),
    stopped: () => false,
    progress: vi.fn(),
    ...over,
  };
  return { d, steps };
}

describe('element training', () => {
  it('finds what an action opened, at most TRAIN_EXPLORE', () => {
    expect(openedElements(image([BUTTON]), image([BUTTON, ...POPUP_LINKS]))).toHaveLength(2);
    expect(openedElements(image([BUTTON]), image([BUTTON]))).toEqual([]);
    const many: Array<[number, number, number, number]> = [0, 1, 2, 3, 4].map((i) => [100, 20 + i * 30, 200, 32 + i * 30]);
    expect(openedElements(image([]), image(many))).toHaveLength(TRAIN_EXPLORE);
  });

  it('trains with the perform function, else a click on the element centre', () => {
    const plain = trainingStep(el, [el]);
    expect(plain).toMatchObject({ action: 'click', target: 'Menu' });
    expect(plain.x).toBeCloseTo(40 / W);
    const typed = trainingStep({ ...el, perform: { kind: 'type', text: 'hi', source: 'user' } }, [el]);
    expect(typed).toMatchObject({ action: 'type', text: 'hi', mappedId: 'e' });
  });

  it('uses the element, explores each opened link (click, screenshot, Escape) and researches it', async () => {
    const { d, steps } = deps();
    const report = await trainElement(el, [el], 'background', d, 5);
    expect(steps.map((s) => s.action)).toEqual(['click', 'click', 'key', 'click', 'key']);
    expect(steps.filter((s) => s.action === 'key').every((s) => s.text === 'Escape')).toBe(true);
    expect(report.related).toHaveLength(2);
    expect(report.entries).toHaveLength(5);
    expect(report.entries.every((e) => e.shot)).toBe(true);
    expect(report).toMatchObject({ elementId: 'e', mode: 'background', startedAt: 5, status: 'pass', research: 'Opens the main menu.' });
    expect(d.research).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.research).mock.calls[0][2]).toHaveLength(2);
    expect(vi.mocked(d.progress).mock.calls.at(-1)?.[0].status).toBe('pass');
  });

  it('fails without exploring when the element action fails', async () => {
    const { d, steps } = deps({ perform: vi.fn(async (s: WorkflowStep) => ({ ok: false, message: `refused ${s.name}` })) });
    const report = await trainElement(el, [el], 'foreground', d);
    expect(report.status).toBe('fail');
    expect(steps).toHaveLength(0);
    expect(report.entries).toHaveLength(1);
    expect(report.related).toEqual([]);
  });

  it('stops when the session is stopped, without research', async () => {
    let stop = false;
    const { d, steps } = deps({ stopped: () => stop });
    const perform = d.perform;
    d.perform = async (s) => {
      const out = await perform(s);
      stop = true;
      return out;
    };
    const report = await trainElement(el, [el], 'foreground', d);
    expect(report.status).toBe('aborted');
    expect(steps).toHaveLength(1);
    expect(d.research).not.toHaveBeenCalled();
    expect(report.research).toBeNull();
  });

  it('records an unavailable AI instead of inventing research', async () => {
    const { d } = deps({ research: vi.fn(async () => { throw new Error('offline'); }) });
    const report = await trainElement(el, [el], 'background', d);
    expect(report.research).toBeNull();
    expect(report.entries.at(-1)).toMatchObject({ label: 'Train: research', ok: false });
    expect(report.status).toBe('pass');
  });
});
