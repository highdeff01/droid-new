import { describe, expect, it, vi } from 'vitest';
import {
  askShotConfirm,
  buildSlides,
  completeness,
  composeSlide,
  finishPresentation,
  screenshotCheck,
  type Slide,
  type SlideSource,
} from './presentation.js';
import type { AskFn } from './ai.js';
import type { Frame } from './types.js';

const imageData = () =>
  (typeof ImageData !== 'undefined'
    ? new ImageData(320, 180)
    : { data: new Uint8ClampedArray(320 * 180 * 4), width: 320, height: 180 }) as ImageData;

const shot = (url = 'data:image/jpeg;base64,' + 'A'.repeat(40)): Frame => ({
  id: 1,
  time: 0,
  url,
  data: imageData(),
  srcW: 1920,
  srcH: 1080,
  source: 'demo',
});

describe('buildSlides', () => {
  it('makes one draft slide per source with pending checks and trimmed notes', () => {
    const sources: SlideSource[] = [
      { title: ' Intro ', notes: [' line one ', '  ', 'line two'], research: [] },
      { title: 'Second' },
    ];
    const p = buildSlides(' My Deck ', sources, 123);
    expect(p.name).toBe('My Deck');
    expect(p.created).toBe(123);
    expect(p.status).toBe('draft');
    expect(p.slides).toHaveLength(2);
    expect(p.slides[0].title).toBe('Intro');
    expect(p.slides[0].notes).toEqual(['line one', 'line two']);
    expect(p.slides[0].checks).toEqual({ screenshot: 'pending', completeness: 'pending' });
    expect(p.slides[1].notes).toEqual([]);
  });
});

describe('completeness', () => {
  it('fails without notes and research', () => {
    const s = composeSlide({ title: 'Empty' });
    const r = completeness(s);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('no notes or research');
  });

  it('passes with one research line', () => {
    const s = composeSlide({ title: 'Has research', research: ['found it'] });
    const r = completeness(s);
    expect(r.ok).toBe(true);
  });
});

describe('screenshotCheck', () => {
  it("'skipped' without a screenshot", async () => {
    const s = composeSlide({ title: 'No shot' });
    const r = await screenshotCheck(s, null, null);
    expect(r.state).toBe('skipped');
  });

  it('fail' + " for a non-decodable url", async () => {
    const s = composeSlide({ title: 'Bad', shot: shot('data:image/jpeg;base64,short') });
    const r = await screenshotCheck(s, shot(), null);
    expect(r.state).toBe('fail');
  });

  it("'pass' offline (confirm null) with a decodable url", async () => {
    const s = composeSlide({ title: 'Good', shot: shot() });
    const r = await screenshotCheck(s, shot(), null);
    expect(r.state).toBe('pass');
  });

  it("'fail' when confirm returns shown:false", async () => {
    const s = composeSlide({ title: 'Good', shot: shot() });
    const confirm = vi.fn(async () => ({ shown: false, reason: 'nope' }));
    const r = await screenshotCheck(s, shot(), confirm);
    expect(r.state).toBe('fail');
  });
});

describe('finishPresentation', () => {
  it("'done' only when every slide passed (skipped screenshot counts as passing)", () => {
    const p = buildSlides('Deck', [{ title: 'A' }], 0);
    const slide: Slide = { ...p.slides[0], checks: { screenshot: 'skipped', completeness: 'pass' } };
    expect(finishPresentation(p, [slide]).status).toBe('done');
  });

  it("'incomplete' otherwise and for zero slides", () => {
    const p = buildSlides('Deck', [{ title: 'A' }], 0);
    const failing: Slide = { ...p.slides[0], checks: { screenshot: 'fail', completeness: 'pass' } };
    expect(finishPresentation(p, [failing]).status).toBe('incomplete');
    expect(finishPresentation(p, []).status).toBe('incomplete');
  });
});

describe('askShotConfirm', () => {
  it('parses {shown,reason} from a stubbed AskFn and sends the frame', async () => {
    const frame = shot();
    const ask: AskFn = vi.fn(async () => ({ content: JSON.stringify({ shown: true, reason: 'looks right' }), thinking: null }));
    const slide = composeSlide({ title: 'Deck', shot: frame });
    const confirm = askShotConfirm(ask);
    const r = await confirm(slide, frame);
    expect(r).toEqual({ shown: true, reason: 'looks right' });
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ frame }));
  });
});
