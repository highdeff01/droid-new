import { uid } from './planner.js';

/** One shot of a movie: an image (data URL), an optional caption, and how long it is held. */
export interface MovieShot {
  image: string;
  caption?: string;
  holdMs: number;
}

/** A short movie assembled from captured frames and screenshots. */
export interface Movie {
  id: string;
  name: string;
  created: number;
  fps: number;
  /** How long consecutive shots cross-fade. */
  fadeMs: number;
  shots: MovieShot[];
  status: 'draft' | 'verified' | 'incomplete';
}

/** What a movie is assembled from: an image and an optional caption. */
export interface ShotSource {
  image: string;
  caption?: string;
}

/** Defaults: 12 fps, 1.5 s per shot, 400 ms cross-fade; at most 120 shots. */
export const MOVIE_FPS = 12;
export const DEFAULT_HOLD_MS = 1500;
export const FADE_MS = 400;
export const MAX_SHOTS = 120;

const isImage = (url: string) => url.startsWith('data:image/') || /^blob:|^https?:\/\//.test(url);

/** A draft movie of `sources` (non-image sources dropped, at most MAX_SHOTS); throws when no shot is left. */
export function assembleMovie(name: string, sources: ShotSource[], { fps = MOVIE_FPS, holdMs = DEFAULT_HOLD_MS, fadeMs = FADE_MS } = {}, now = Date.now()): Movie {
  const shots = sources.filter((s) => isImage(s.image)).slice(0, MAX_SHOTS).map((s) => ({ image: s.image, ...(s.caption?.trim() ? { caption: s.caption.trim() } : {}), holdMs: Math.max(1, holdMs) }));
  if (!shots.length) throw new Error('no frames or screenshots to render');
  return { id: uid('movie'), name: name.trim() || 'Movie', created: now, fps: Math.max(1, Math.round(fps)), fadeMs: Math.max(0, fadeMs), shots, status: 'draft' };
}

/** Total running time of a movie. */
export const movieDuration = (movie: Movie) => movie.shots.reduce((t, s) => t + s.holdMs, 0);

/** How many video frames a movie renders to. */
export const frameCount = (movie: Movie) => Math.max(1, Math.ceil((movieDuration(movie) / 1000) * movie.fps));

/** What one video frame shows: a shot, the next shot fading in over it (alpha 0..1), the caption and a slow zoom. */
export interface MovieFrame {
  shot: number;
  next: number | null;
  alpha: number;
  caption: string | null;
  zoom: number;
}

/** The video frame at `ms` into the movie; the last shot is held past the end. */
export function movieFrameAt(movie: Movie, ms: number): MovieFrame {
  let start = 0;
  const last = movie.shots.length - 1;
  for (const [shot, s] of movie.shots.entries()) {
    const into = Math.max(0, ms - start);
    if (into < s.holdMs || shot === last) {
      const t = Math.min(1, into / s.holdMs);
      const fading = shot < last && movie.fadeMs > 0 && into > s.holdMs - movie.fadeMs;
      return { shot, next: fading ? shot + 1 : null, alpha: fading ? (into - (s.holdMs - movie.fadeMs)) / movie.fadeMs : 0, caption: s.caption ?? null, zoom: 1 + 0.05 * t };
    }
    start += s.holdMs;
  }
  return { shot: 0, next: null, alpha: 0, caption: null, zoom: 1 };
}

/** Every video frame of the movie in order, at its fps. */
export const renderPlan = (movie: Movie): MovieFrame[] => Array.from({ length: frameCount(movie) }, (_, i) => movieFrameAt(movie, (i * 1000) / movie.fps));

function drawZoomed(ctx: CanvasRenderingContext2D, img: CanvasImageSource, w: number, h: number, zoom: number) {
  const zw = w * zoom, zh = h * zoom;
  ctx.drawImage(img, (w - zw) / 2, (h - zh) / 2, zw, zh);
}

/** Paints one video frame onto a w×h canvas from the loaded shot images (same order as the shots). */
export function paintMovieFrame(ctx: CanvasRenderingContext2D, w: number, h: number, images: CanvasImageSource[], f: MovieFrame) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  drawZoomed(ctx, images[f.shot], w, h, f.zoom);
  if (f.next !== null) {
    ctx.globalAlpha = f.alpha;
    drawZoomed(ctx, images[f.next], w, h, 1);
    ctx.globalAlpha = 1;
  }
  if (!f.caption) return;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, h * 0.84, w, h * 0.16);
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.round(h * 0.05)}px sans-serif`;
  ctx.fillText(f.caption, w * 0.04, h * 0.93);
}

/** What recording a movie needs from the browser. */
export interface RecordDeps {
  canvas: HTMLCanvasElement;
  loadImage: (url: string) => Promise<CanvasImageSource>;
  /** Waits one frame interval; real time while recording. */
  sleep: (ms: number) => Promise<unknown>;
}

/** Why this browser cannot record a movie, or null when it can. */
export function recordUnsupported(canvas: HTMLCanvasElement): string | null {
  if (typeof canvas.captureStream !== 'function') return 'canvas.captureStream is not available in this browser';
  if (typeof MediaRecorder === 'undefined') return 'MediaRecorder is not available in this browser';
  return null;
}

/** Renders every frame of the movie onto the canvas while MediaRecorder records it; resolves with the webm Blob. */
export async function recordMovie(movie: Movie, deps: RecordDeps): Promise<Blob> {
  const why = recordUnsupported(deps.canvas);
  if (why) throw new Error(`cannot export the movie — ${why}`);
  const ctx = deps.canvas.getContext('2d');
  if (!ctx) throw new Error('cannot export the movie — no 2d canvas context');
  const images = await Promise.all(movie.shots.map((s) => deps.loadImage(s.image)));
  const recorder = new MediaRecorder(deps.canvas.captureStream(movie.fps), { mimeType: 'video/webm' });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  recorder.start();
  for (const f of renderPlan(movie)) {
    paintMovieFrame(ctx, deps.canvas.width, deps.canvas.height, images, f);
    await deps.sleep(1000 / movie.fps);
  }
  recorder.stop();
  await stopped;
  return new Blob(chunks, { type: 'video/webm' });
}

/** One-line text of a movie for the log and notifications. */
export const movieText = (movie: Movie) => `Movie "${movie.name}" ${movie.status.toUpperCase()} — ${movie.shots.length} shot(s), ${frameCount(movie)} frames at ${movie.fps} fps, ${(movieDuration(movie) / 1000).toFixed(1)}s`;
