import { describe, expect, it, vi } from 'vitest';
import { AD_VISIBLE_TICK, SAMPLE_WORKFLOWS, recordingTemplate, sampleOperations, sceneTick, type SampleScene } from './sample-workflows.js';
import { runAiFree } from './ai-free.js';
import { demoAd } from './demo-desktop.js';
import { boxFrame, boxImage } from './test-frames.js';
import type { WorkflowStep } from './types.js';

const scenes: SampleScene[] = [];
/** A renderer that draws a box at every sample target of the scene, standing in for the demo canvas. */
const render = vi.fn((scene: SampleScene) => {
  scenes.push(scene);
  const targets = SAMPLE_WORKFLOWS.flatMap((s) => s.steps).filter((st) => st.scene.quest === scene.quest && st.scene.ad === scene.ad);
  return boxFrame(boxImage(targets.map((t) => ({ x: Math.round(t.x * 320), y: Math.round(t.y * 180) }))), scenes.length);
});

describe('SAMPLE_WORKFLOWS', () => {
  it('ships the demo tours, a popup dismissal and a drag-and-drop', () => {
    const goals = SAMPLE_WORKFLOWS.map((s) => s.goal).join(' | ');
    for (const word of [/Files/, /quest world/, /sword/, /priest/, /calculator/, /popup/, /drag/]) expect(goals).toMatch(word);
    expect(SAMPLE_WORKFLOWS.flatMap((s) => s.steps).filter((s) => s.action === 'drag').length).toBeGreaterThanOrEqual(2);
  });

  it('aims the popup step at the close button of the visible ad', () => {
    const ad = demoAd(AD_VISIBLE_TICK);
    expect(ad.visible).toBe(true);
    const close = SAMPLE_WORKFLOWS.flatMap((s) => s.steps).find((s) => s.scene.ad)!;
    expect(close).toMatchObject({ x: ad.closeX, y: ad.closeY });
    expect(sceneTick(close.scene)).toBe(AD_VISIBLE_TICK);
    expect(demoAd(sceneTick({ quest: false, ad: false })).visible).toBe(false);
  });

  it('gives every drag step a drop point inside the screen', () => {
    for (const s of SAMPLE_WORKFLOWS.flatMap((w) => w.steps).filter((st) => st.action === 'drag')) {
      expect(s.endX).toBeGreaterThan(0);
      expect(s.endY).toBeLessThan(1);
    }
  });
});

describe('sampleOperations', () => {
  it('installs every sample as a recorded operation with a reference frame on every step, each scene rendered once', () => {
    render.mockClear();
    const ops = sampleOperations(render);
    expect(ops.map((o) => o.name)).toEqual(SAMPLE_WORKFLOWS.map((s) => s.name));
    expect(ops.every((o) => o.source === 'recorded')).toBe(true);
    expect(ops.flatMap((o) => o.steps).every((s) => !!s.refFrame?.data)).toBe(true);
    expect(render).toHaveBeenCalledTimes(3);
    expect(ops.every((o) => o.screenshots.length >= 1)).toBe(true);
  });

  it('keeps the steps without a reference frame when no canvas can render them', () => {
    const ops = sampleOperations(() => null);
    expect(ops.flatMap((o) => o.steps).some((s) => s.refFrame)).toBe(false);
    expect(ops.every((o) => o.screenshots.length === 0)).toBe(true);
  });

  it('runs a sample AI-free out of the box: zero AI calls when every target is where its reference shows it', async () => {
    const [files] = sampleOperations(render);
    let shown = true;
    const live = files.steps[0].refFrame!;
    const capture = async () => (shown ? live : boxFrame(boxImage([]), 99));
    const send = vi.fn(async () => {
      shown = false;
      return { ok: true, message: 'completed' };
    });
    const consultAi = vi.fn();
    const run = await runAiFree(files.steps, { capture, send, consultAi, log: () => undefined });
    expect(run).toMatchObject({ ok: true, aiCalls: 0 });
    expect(run.results[0].source).toBe('template');
    expect(consultAi).not.toHaveBeenCalled();
  });
});

describe('recordingTemplate', () => {
  it('turns a sample into fresh pending steps that keep their reference frames', () => {
    const [, tour] = sampleOperations(render);
    const steps: WorkflowStep[] = recordingTemplate({ ...tour, steps: tour.steps.map((s) => ({ ...s, status: 'done', correctedX: 0.1 })) }, (i) => `rec-${i}`);
    expect(steps.map((s) => s.id)).toEqual(tour.steps.map((_, i) => `rec-${i}`));
    expect(steps.every((s) => s.status === 'pending' && s.correctedX === undefined && !!s.refFrame)).toBe(true);
  });
});
