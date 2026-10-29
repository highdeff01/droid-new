import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssist } from './use-assist.js';
import { AD_CYCLE, demoAd, drawDemoDesktop, initialDemoFile, initialDemoIcons } from './demo-desktop.js';
import { QUEST_TOGGLE, findQuestElement, initialQuest } from './quest-world.js';
import { DEFAULT_CHANGE_CELLS, detectChange } from './screen-change.js';

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const quest = initialQuest();
const pointOf = (name: string) => {
  const el = findQuestElement(quest, name)!;
  return { x: el.x, y: el.y };
};
const youSaid = (r: { current: ReturnType<typeof useAssist> }) => r.current.log.filter((l) => l.source === 'You').map((l) => l.message);

async function inQuest() {
  const { result } = renderHook(() => useAssist());
  await act(async () => {});
  act(() => result.current.useQuestWorld());
  return result;
}

/** A model that plans `steps` for any goal and approves every step it is asked about. */
function modelPlanning(steps: Record<string, unknown>[]) {
  const replies: Record<string, Record<string, unknown>> = {
    plan: { content: JSON.stringify({ steps }), thinking: 'Planned on the quest world.' },
    reflect: { content: 'Done.', thinking: null },
    verdict: { content: '{"success":true,"pattern_avoid":null,"pattern_add":null}', thinking: null },
    propose: { content: '{"ready":true,"x":0.5,"y":0.5,"why":"the step is the goal."}', thinking: null },
  };
  const prompts: string[] = [];
  const pick = (body: string) => (body.includes('final verdict') ? 'verdict' : body.includes('reviewing a step') ? 'reflect' : body.includes('state WHAT') ? 'propose' : 'plan');
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    prompts.push(String(init.body));
    return new Response(JSON.stringify({ message: { role: 'assistant', ...replies[pick(String(init.body))] } }), { status: 200 });
  }));
  return prompts;
}

describe('useAssist quest world source', () => {
  it('selects the demo source with the quest scene shown, and the taskbar button switches back', async () => {
    const result = await inQuest();
    expect(result.current.source).toBe('demo');
    expect(result.current.log.some((l) => /Quest world selected/.test(l.message))).toBe(true);
    act(() => result.current.onStageClick(QUEST_TOGGLE.x, QUEST_TOGGLE.y));
    expect(youSaid(result)[0]).toMatch(/Switched to the Desktop/);
    act(() => result.current.onStageClick(QUEST_TOGGLE.x, QUEST_TOGGLE.y));
    expect(youSaid(result)[0]).toMatch(/Switched to the Quest world/);
  });

  it('routes stage clicks, double-clicks, typing keys and drags to the quest', async () => {
    const result = await inQuest();
    act(() => result.current.onStageClick(pointOf('Dragon Gate').x, pointOf('Dragon Gate').y));
    expect(youSaid(result)[0]).toMatch(/Dragon Gate is locked/);
    act(() => result.current.onStageDoubleClick(pointOf('Mystery Box').x, pointOf('Mystery Box').y));
    expect(youSaid(result)[0]).toMatch(/Golden Key/);
    act(() => result.current.onStageClick(pointOf('Dragon Gate').x, pointOf('Dragon Gate').y));
    expect(youSaid(result)[0]).toMatch(/Unlocked the Dragon Gate/);
    act(() => result.current.onStageKey(new KeyboardEvent('keydown', { key: 'h' })));
    act(() => result.current.onStageKey(new KeyboardEvent('keydown', { key: 'i' })));
    expect(youSaid(result)[0]).toMatch(/Priest replied/);
    act(() => result.current.onStageDrag(pointOf('Hat'), pointOf('Mage Girl')));
    expect(youSaid(result)[0]).toMatch(/Equipped Hat to Mage Girl — Mage Girl now weighs 17 kg/);
  });

  it('records a drag from the Sword to the Knight as one drag step targeting the Sword', async () => {
    const result = await inQuest();
    act(() => result.current.toggleRecording());
    act(() => result.current.onStageDrag(pointOf('Sword'), pointOf('Knight Guy')));
    act(() => result.current.toggleRecording());
    expect(result.current.steps).toHaveLength(1);
    expect(result.current.steps[0]).toMatchObject({ action: 'drag', target: 'Sword', x: pointOf('Sword').x, y: pointOf('Sword').y, endX: pointOf('Knight Guy').x, endY: pointOf('Knight Guy').y });
    expect(result.current.log.some((l) => l.source === 'Recorder' && /drag of "Sword"/.test(l.message))).toBe(true);
  });

  it('records a drag of a hero with its target, and a sidebar icon drag on the quest scene as before', async () => {
    const result = await inQuest();
    act(() => result.current.toggleRecording());
    act(() => result.current.onStageDrag(pointOf('Mage Girl'), { x: 0.3, y: 0.3 }));
    act(() => result.current.onStageDrag({ x: 0.055, y: 0.105 }, { x: 0.055, y: 0.6 }));
    act(() => result.current.toggleRecording());
    expect(result.current.steps.map((s) => s.target)).toEqual(['Mage Girl', undefined]);
    expect(result.current.steps[1]).toMatchObject({ action: 'drag', x: 0.055, y: 0.105, endX: 0.055, endY: 0.6 });
  });
});

describe('useAssist plans, grounds, clicks and verifies on the quest world', () => {
  it('gives the planner the quest scene and grounds each named step on the quest element table', async () => {
    const prompts = modelPlanning([
      { name: 'Open the Mystery Box', action: 'double_click', target: 'Mystery Box', x: 0.05, y: 0.05 },
      { name: 'Open the Dragon Gate', action: 'click', target: 'Dragon Gate', x: 0.05, y: 0.05 },
      { name: 'Equip the sword', action: 'click', target: 'Sword', x: 0.05, y: 0.05 },
    ]);
    const result = await inQuest();
    act(() => result.current.setGoal('open the dragon gate and equip the sword'));
    await act(() => result.current.autoPlan());
    const planPrompt = prompts.find((p) => p.includes('[Quest world]'));
    expect(planPrompt).toMatch(/\[Quest world\] Knight Guy/);
    expect(planPrompt).toMatch(/Dragon Gate locked/);
    expect(result.current.steps.map((s) => s.target)).toEqual(['Mystery Box', 'Dragon Gate', 'Sword']);
    act(() => result.current.toggleArmed());
    await act(() => result.current.replay());
    const said = result.current.log.map((l) => l.message).join('\n');
    expect(said).toMatch(/Opened the Mystery Box: found the Golden Key/);
    expect(said).toMatch(/Unlocked the Dragon Gate with the Golden Key/);
    expect(said).toMatch(/Equipped Sword to Knight Guy — Knight Guy now weighs 30 kg/);
    const gate = pointOf('Dragon Gate');
    expect(result.current.history.find((h) => /Unlocked the Dragon Gate/.test(h.message))).toMatchObject({ via: 'demo', ok: true, x: Math.round(gate.x * 960), y: Math.round(gate.y * 540) });
  });

  it('teaches the coordinate learner the quest element it clicked', async () => {
    modelPlanning([{ name: 'Start the game', action: 'click', target: 'Start Game', x: 0.05, y: 0.05 }]);
    const result = await inQuest();
    act(() => result.current.setGoal('start the game'));
    await act(() => result.current.autoPlan());
    act(() => result.current.toggleArmed());
    await act(() => result.current.replay());
    expect(result.current.log.some((l) => /Started the Quest Adventure game/.test(l.message))).toBe(true);
    const learned = result.current.familiar.find((f) => f.name === 'Start Game');
    expect(learned).toMatchObject({ x: pointOf('Start Game').x, y: pointOf('Start Game').y });
  });

  it('test-clicks a quest element through the gated pipeline and learns it', async () => {
    const result = await inQuest();
    act(() => result.current.toggleArmed());
    const talk = pointOf('Talk');
    await act(() => result.current.testClick({ id: 'el-talk', name: 'Talk', x: talk.x, y: talk.y, source: 'familiar' }));
    expect(result.current.log.find((l) => l.source === 'Test click')?.message).toMatch(/Talk.*Priest: "Welcome traveler/);
    expect(result.current.familiar.some((f) => f.name === 'Talk')).toBe(true);
  });
});

/** A canvas context that rasterizes fillRect into a 320×180 RGBA buffer and ignores everything else. */
function rasterContext() {
  const W = 320;
  const H = 180;
  const data = new Uint8ClampedArray(W * H * 4);
  const texts: string[] = [];
  let color = [0, 0, 0];
  const parse = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : [40, 40, 40]);
  const ctx = {
    set fillStyle(c: unknown) {
      color = typeof c === 'string' ? parse(c) : [30, 30, 40];
    },
    fillRect(x: number, y: number, w: number, h: number) {
      for (let j = Math.max(0, Math.floor(y)); j < Math.min(H, Math.ceil(y + h)); j++)
        for (let i = Math.max(0, Math.floor(x)); i < Math.min(W, Math.ceil(x + w)); i++) data.set([...color, 255], (j * W + i) * 4);
    },
    fillText: (t: string) => texts.push(t),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    strokeRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    font: '',
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, image: () => new ImageData(data.slice(), W, H), texts };
}

describe('MEGA OFFER popup on the quest world', () => {
  it('appears over the quest arena as a change the popup watcher detects', () => {
    const shown = AD_CYCLE + 15;
    const before = rasterContext();
    drawDemoDesktop(before.ctx, 320, 180, shown - 1, false, initialDemoFile(), initialDemoIcons(), null, initialQuest());
    const after = rasterContext();
    drawDemoDesktop(after.ctx, 320, 180, shown, false, initialDemoFile(), initialDemoIcons(), null, initialQuest());
    expect(after.texts).toContain('MEGA OFFER!!!');
    expect(before.texts).not.toContain('MEGA OFFER!!!');
    const change = detectChange(before.image(), after.image(), DEFAULT_CHANGE_CELLS);
    const ad = demoAd(shown);
    expect(change).not.toBeNull();
    expect(change!.box.x).toBeLessThan(ad.x + ad.w);
    expect(change!.box.x + change!.box.w).toBeGreaterThan(ad.x);
    expect(change!.box.y).toBeLessThan(ad.y + ad.h);
    expect(change!.box.y + change!.box.h).toBeGreaterThan(ad.y);
  });

  it('leaves the arena under the ad clickable while the ad is hidden', async () => {
    const result = await inQuest();
    const ad = demoAd(AD_CYCLE + 15);
    // The engine starts at tick 0, when the ad is hidden: the Treasure Chest under its area takes the click.
    const chest = pointOf('Treasure Chest');
    expect(chest.x).toBeGreaterThan(ad.x);
    expect(chest.y).toBeGreaterThan(ad.y);
    act(() => result.current.onStageClick(pointOf('Treasure Chest').x, pointOf('Treasure Chest').y));
    expect(youSaid(result)[0]).toMatch(/Opened the Treasure Chest: Crown, Magic Potion/);
  });
});
