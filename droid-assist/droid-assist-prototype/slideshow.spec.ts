import { describe, expect, it, vi } from 'vitest';
import {
  assembleSlide,
  assembleSlideshow,
  checkSlide,
  DEFAULT_SLIDE_MS,
  MAX_SLIDES,
  playbackAt,
  slideshowHtml,
  slideshowText,
  TRANSITION_MS,
  TRANSITION_STYLE,
  type ShowSlide,
  type SlideItem,
  type SlideSpec,
  type Slideshow,
} from './slideshow.js';
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

describe('assembleSlide', () => {
  it('a preferred frame item wins over a screenshot', () => {
    const items: SlideItem[] = [{ kind: 'screenshot', frame: shot('shot-url') }, { kind: 'frame', frame: shot('frame-url') }];
    const slide = assembleSlide({ title: 'T', items });
    expect(slide.image).toBe('frame-url');
    expect(slide.imageFrom).toBe('frame');
  });

  it('a screenshot only is used when there is no preferred frame', () => {
    const slide = assembleSlide({ title: 'T', items: [{ kind: 'screenshot', frame: shot('shot-url') }] });
    expect(slide.image).toBe('shot-url');
    expect(slide.imageFrom).toBe('screenshot');
  });

  it('no image item leaves image null', () => {
    const slide = assembleSlide({ title: 'T', items: [{ kind: 'note', text: 'hi' }] });
    expect(slide.image).toBeNull();
    expect(slide.imageFrom).toBeNull();
  });

  it('drops blank notes', () => {
    const slide = assembleSlide({ title: 'T', items: [{ kind: 'note', text: '  ' }, { kind: 'note', text: 'line two' }] });
    expect(slide.notes).toEqual(['line two']);
  });

  it('keeps a research finding and its source', () => {
    const slide = assembleSlide({ title: 'T', items: [{ kind: 'research', text: 'found it', source: 'web' }] });
    expect(slide.research).toEqual([{ text: 'found it', source: 'web' }]);
  });

  it('defaults to fade transition and DEFAULT_SLIDE_MS when the spec gives none', () => {
    const slide = assembleSlide({ title: 'T', items: [] });
    expect(slide.transition).toBe('fade');
    expect(slide.durationMs).toBe(DEFAULT_SLIDE_MS);
  });

  it('keeps a given transition and duration', () => {
    const slide = assembleSlide({ title: 'T', items: [], transition: 'zoom', durationMs: 1234 });
    expect(slide.transition).toBe('zoom');
    expect(slide.durationMs).toBe(1234);
  });
});

describe('assembleSlideshow', () => {
  const withNote = (title: string): SlideSpec => ({ title, items: [{ kind: 'note', text: 'n' }] });

  it('drops empty slides', () => {
    const show = assembleSlideshow('Deck', [withNote('A'), { title: 'Empty', items: [] }]);
    expect(show.slides).toHaveLength(1);
    expect(show.slides[0].title).toBe('A');
  });

  it('caps at MAX_SLIDES', () => {
    const specs = Array.from({ length: MAX_SLIDES + 5 }, (_, i) => withNote(`S${i}`));
    const show = assembleSlideshow('Deck', specs);
    expect(show.slides).toHaveLength(MAX_SLIDES);
  });

  it('starts as draft', () => {
    const show = assembleSlideshow('Deck', [withNote('A')]);
    expect(show.status).toBe('draft');
  });

  it('throws when every slide is empty', () => {
    expect(() => assembleSlideshow('Deck', [{ title: 'Empty', items: [] }])).toThrow();
  });

  it('falls back to "Slideshow" for a blank name', () => {
    const show = assembleSlideshow('   ', [withNote('A')]);
    expect(show.name).toBe('Slideshow');
  });
});

const makeShow = (): Slideshow => ({
  id: 'show-1',
  name: 'Deck',
  created: 0,
  status: 'draft',
  slides: [
    { id: 's1', title: 'One', image: null, imageFrom: null, notes: ['n'], research: [], transition: 'fade', durationMs: 1000 },
    { id: 's2', title: 'Two', image: null, imageFrom: null, notes: ['n'], research: [], transition: 'fade', durationMs: 2000 },
  ],
});

describe('playbackAt', () => {
  it('starts at index 0 at elapsed 0', () => {
    expect(playbackAt(makeShow(), 0)).toEqual({ index: 0, progress: 0, transition: 0 });
  });

  it('reaches the second slide with progress through it', () => {
    const r = playbackAt(makeShow(), 1500);
    expect(r?.index).toBe(1);
    expect(r?.progress).toBeCloseTo(0.25);
  });

  it('transition fraction is elapsed-into-slide over TRANSITION_MS, capped at 1', () => {
    const early = playbackAt(makeShow(), 1300);
    expect(early?.transition).toBeCloseTo(300 / TRANSITION_MS);
    const late = playbackAt(makeShow(), 1800);
    expect(late?.transition).toBe(1);
  });

  it("transition fraction is always 1 for a 'cut' slide", () => {
    const show = makeShow();
    show.slides[1].transition = 'cut';
    const r = playbackAt(show, 1050);
    expect(r?.transition).toBe(1);
  });

  it('is null once playback has run past the end', () => {
    expect(playbackAt(makeShow(), 3000)).toBeNull();
  });
});

describe('TRANSITION_STYLE', () => {
  it('fade at 0.5 is half-opaque with no transform', () => {
    expect(TRANSITION_STYLE.fade(0.5)).toEqual({ opacity: 0.5, transform: 'none' });
  });

  it('slide at 0 starts fully off-screen to the right', () => {
    expect(TRANSITION_STYLE.slide(0)).toEqual({ opacity: 1, transform: 'translateX(100%)' });
  });

  it('cut is always fully opaque', () => {
    expect(TRANSITION_STYLE.cut(0).opacity).toBe(1);
  });
});

const baseSlide: ShowSlide = { id: 's', title: 'Good', image: null, imageFrom: null, notes: [], research: [], transition: 'fade', durationMs: 1000 };

describe('checkSlide', () => {
  it('fails without a title', async () => {
    const r = await checkSlide({ ...baseSlide, title: '' }, null);
    expect(r).toEqual({ ok: false, reason: 'slide has no title' });
  });

  it('passes a text-only slide', async () => {
    const r = await checkSlide({ ...baseSlide, notes: ['a note'] }, null);
    expect(r.ok).toBe(true);
  });

  it('fails when the image is not decodable', async () => {
    const r = await checkSlide({ ...baseSlide, image: 'data:image/jpeg;base64,short', imageFrom: 'screenshot' }, null);
    expect(r.ok).toBe(false);
  });

  it('passes a decodable image with null confirm, noting the AI is offline', async () => {
    const r = await checkSlide({ ...baseSlide, image: shot().url, imageFrom: 'screenshot' }, null);
    expect(r.ok).toBe(true);
    expect(r.reason).toContain('AI offline');
  });

  it("returns confirm's result when given", async () => {
    const confirm = vi.fn(async () => ({ ok: true, reason: 'AI confirmed it' }));
    const slide = { ...baseSlide, image: shot().url, imageFrom: 'screenshot' as const };
    const r = await checkSlide(slide, confirm);
    expect(r).toEqual({ ok: true, reason: 'AI confirmed it' });
    expect(confirm).toHaveBeenCalledWith(slide);
  });
});

describe('slideshowHtml', () => {
  const evil = '<script>evil</script>';
  const show = assembleSlideshow('Deck', [
    { title: evil, items: [{ kind: 'screenshot', frame: shot() }, { kind: 'note', text: evil }] },
    { title: 'Second', items: [{ kind: 'note', text: 'n' }], durationMs: 2500 },
  ]);
  const html = slideshowHtml(show);

  it('is a standalone HTML document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  it('has one <section class="slide ..."> per slide', () => {
    expect(html.match(/<section class="slide /g)).toHaveLength(show.slides.length);
  });

  it("carries each slide's duration as data-ms", () => {
    for (const slide of show.slides) expect(html).toContain(`data-ms="${slide.durationMs}"`);
  });

  it('includes the image src', () => {
    expect(html).toContain(`src="${show.slides[0].image}"`);
  });

  it('escapes <script> in titles and notes', () => {
    expect(html).not.toContain(evil);
    expect(html).toContain('&lt;script&gt;evil&lt;/script&gt;');
  });
});

describe('slideshowText', () => {
  it('mentions the name, uppercase status and slide count', () => {
    const show = assembleSlideshow('My Deck', [{ title: 'A', items: [{ kind: 'note', text: 'n' }] }]);
    const text = slideshowText(show);
    expect(text).toContain('My Deck');
    expect(text).toContain('DRAFT');
    expect(text).toContain(`${show.slides.length} slide`);
  });
});
