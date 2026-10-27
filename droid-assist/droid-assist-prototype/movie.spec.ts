import { describe, expect, it, vi } from 'vitest';
import {
  assembleMovie,
  DEFAULT_HOLD_MS,
  FADE_MS,
  frameCount,
  MOVIE_FPS,
  movieFrameAt,
  movieText,
  paintMovieFrame,
  recordMovie,
  recordUnsupported,
  renderPlan,
  type Movie,
  type MovieFrame,
  type ShotSource,
} from './movie.js';

const img = (n: number) => `data:image/png;base64,${'A'.repeat(n)}`;

describe('assembleMovie', () => {
  const sources: ShotSource[] = [
    { image: img(10), caption: '  Intro  ' },
    { image: 'not-an-image' },
    { image: 'https://example.com/pic.jpg' },
  ];

  it('drops non-image sources', () => {
    const movie = assembleMovie('M', sources);
    expect(movie.shots.map((s) => s.image)).toEqual([img(10), 'https://example.com/pic.jpg']);
  });

  it('trims captions', () => {
    const movie = assembleMovie('M', sources);
    expect(movie.shots[0].caption).toBe('Intro');
  });

  it('uses MOVIE_FPS, DEFAULT_HOLD_MS and FADE_MS as defaults', () => {
    const movie = assembleMovie('M', sources);
    expect(movie.fps).toBe(MOVIE_FPS);
    expect(movie.shots[0].holdMs).toBe(DEFAULT_HOLD_MS);
    expect(movie.fadeMs).toBe(FADE_MS);
  });

  it('honours given fps, holdMs and fadeMs options', () => {
    const movie = assembleMovie('M', sources, { fps: 24, holdMs: 500, fadeMs: 100 });
    expect(movie.fps).toBe(24);
    expect(movie.shots[0].holdMs).toBe(500);
    expect(movie.fadeMs).toBe(100);
  });

  it('throws when no source is a usable image', () => {
    expect(() => assembleMovie('M', [{ image: 'not-an-image' }])).toThrow();
  });
});

const threeShots: ShotSource[] = [{ image: img(1) }, { image: img(2) }, { image: img(3) }];

describe('frameCount', () => {
  it('3 shots x 1000ms at 10 fps makes 30 frames', () => {
    const movie = assembleMovie('M', threeShots, { fps: 10, holdMs: 1000 });
    expect(frameCount(movie)).toBe(30);
  });

  it('renderPlan has one entry per frame', () => {
    const movie = assembleMovie('M', threeShots, { fps: 10, holdMs: 1000 });
    expect(renderPlan(movie)).toHaveLength(frameCount(movie));
  });
});

const twoShots: ShotSource[] = [{ image: img(1), caption: 'Hello' }, { image: img(2) }];
const makeMovie = (): Movie => assembleMovie('M', twoShots, { holdMs: 1000, fadeMs: 200 });

describe('movieFrameAt', () => {
  it('shows the first shot with no next before the fade window', () => {
    const f = movieFrameAt(makeMovie(), 500);
    expect(f.shot).toBe(0);
    expect(f.next).toBeNull();
  });

  it('cross-fades into the next shot inside the fade window', () => {
    const f = movieFrameAt(makeMovie(), 900);
    expect(f.shot).toBe(0);
    expect(f.next).toBe(1);
    expect(f.alpha).toBeCloseTo(0.5);
  });

  it('the last shot never has a next and is held past the end', () => {
    const f = movieFrameAt(makeMovie(), 10_000);
    expect(f.shot).toBe(1);
    expect(f.next).toBeNull();
  });

  it('carries the caption of the current shot', () => {
    const f = movieFrameAt(makeMovie(), 0);
    expect(f.caption).toBe('Hello');
  });

  it('zoom grows from 1 toward 1.05 across the hold', () => {
    const start = movieFrameAt(makeMovie(), 0);
    const end = movieFrameAt(makeMovie(), 999);
    expect(start.zoom).toBe(1);
    expect(end.zoom).toBeGreaterThan(start.zoom);
    expect(end.zoom).toBeLessThanOrEqual(1.05);
  });
});

function mockCtx() {
  const alphaLog: number[] = [];
  let alpha = 1;
  const drawImage = vi.fn();
  const fillText = vi.fn();
  const ctx = {
    fillStyle: '',
    font: '',
    drawImage,
    fillRect: vi.fn(),
    fillText,
    get globalAlpha() {
      return alpha;
    },
    set globalAlpha(v: number) {
      alpha = v;
      alphaLog.push(v);
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, alphaLog, drawImage, fillText };
}

const images = [{}, {}] as unknown as CanvasImageSource[];
const frameNoFade: MovieFrame = { shot: 0, next: null, alpha: 0, caption: null, zoom: 1 };
const frameFading: MovieFrame = { shot: 0, next: 1, alpha: 0.5, caption: null, zoom: 1 };

describe('paintMovieFrame', () => {
  it('draws once when there is no fade', () => {
    const { ctx, drawImage } = mockCtx();
    paintMovieFrame(ctx, 100, 100, images, frameNoFade);
    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it('draws twice during a fade, setting globalAlpha to the fade alpha', () => {
    const { ctx, alphaLog, drawImage } = mockCtx();
    paintMovieFrame(ctx, 100, 100, images, frameFading);
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(alphaLog).toContain(0.5);
  });

  it('calls fillText with the caption only when there is one', () => {
    const { ctx: ctxNoCaption, fillText: noCaption } = mockCtx();
    paintMovieFrame(ctxNoCaption, 100, 100, images, frameNoFade);
    expect(noCaption).not.toHaveBeenCalled();

    const { ctx: ctxWithCaption, fillText: withCaption } = mockCtx();
    paintMovieFrame(ctxWithCaption, 100, 100, images, { ...frameNoFade, caption: 'Caption' });
    expect(withCaption).toHaveBeenCalledWith('Caption', expect.any(Number), expect.any(Number));
  });
});

describe('recordMovie', () => {
  it('rejects mentioning it cannot export the movie when canvas.captureStream is missing', async () => {
    const canvas = document.createElement('canvas');
    const deps = { canvas, loadImage: vi.fn(), sleep: vi.fn() };
    await expect(recordMovie(makeMovie(), deps)).rejects.toThrow('cannot export the movie');
  });
});

describe('recordUnsupported', () => {
  it('returns a reason string when canvas.captureStream is missing', () => {
    const canvas = document.createElement('canvas');
    expect(typeof recordUnsupported(canvas)).toBe('string');
  });
});

describe('movieText', () => {
  it('mentions the shot count, frame count and fps', () => {
    const movie = assembleMovie('M', threeShots, { fps: 10, holdMs: 1000 });
    const text = movieText(movie);
    expect(text).toContain(`${movie.shots.length} shot`);
    expect(text).toContain(`${frameCount(movie)} frames`);
    expect(text).toContain(`${movie.fps} fps`);
  });
});
