import { uid } from './planner.js';

/** What kind of presentation an output is. */
export type OutputKind = 'slideshow' | 'movie';

/** A presentation placed in a project: which output, its kind and name. */
export interface PresentationRef {
  id: string;
  kind: OutputKind;
  name: string;
  added: number;
}

/** A project the user keeps presentations in. */
export interface PresentationProject {
  id: string;
  name: string;
  created: number;
  presentations: PresentationRef[];
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * `ref` added to the project named `name` (created when there is none): appended after what the
 * project already holds; a presentation already in it is not added twice.
 */
export function addToProject(projects: PresentationProject[], name: string, ref: PresentationRef, now = Date.now()): { projects: PresentationProject[]; project: PresentationProject; added: boolean } {
  const existing = projects.find((p) => sameName(p.name, name));
  const base = existing ?? { id: uid('project'), name: name.trim(), created: now, presentations: [] };
  const added = !base.presentations.some((r) => r.id === ref.id);
  const project = added ? { ...base, presentations: [...base.presentations, ref] } : base;
  return { projects: existing ? projects.map((p) => (p.id === project.id ? project : p)) : [project, ...projects], project, added };
}

/** The in-world screen inside the demo game window (fractions of the desktop), clear of the title and the PLAY button. */
export const WORLD_SCREEN = { x: 0.64, y: 0.6, w: 0.16, h: 0.2 } as const;

/** A presentation shown on the in-world screen: its images cycle there, one per `holdTicks` demo ticks. */
export interface WorldEmbed {
  id: string;
  kind: OutputKind;
  title: string;
  images: string[];
  holdTicks: number;
}

/** Demo ticks each image stays on the in-world screen (the demo ticks every 400 ms). */
export const WORLD_HOLD_TICKS = 5;

/** An embed of `images` titled `title`; throws when there is nothing to show. */
export function worldEmbed(id: string, kind: OutputKind, title: string, images: string[]): WorldEmbed {
  const shown = images.filter(Boolean);
  if (!shown.length) throw new Error(`"${title}" has no images to show on the in-world screen`);
  return { id, kind, title: title.trim(), images: shown, holdTicks: WORLD_HOLD_TICKS };
}

/** Which image of the embed the in-world screen shows at demo tick `t`. */
export const worldImageAt = (embed: WorldEmbed, t: number) => Math.floor(Math.max(0, t) / embed.holdTicks) % embed.images.length;

/** Draws the in-world screen of the demo game window: a bezel, the current image (when loaded) and the title. */
export function drawWorldScreen(ctx: CanvasRenderingContext2D, w: number, h: number, title: string, image: CanvasImageSource | null) {
  const x = WORLD_SCREEN.x * w, y = WORLD_SCREEN.y * h, sw = WORLD_SCREEN.w * w, sh = WORLD_SCREEN.h * h;
  ctx.fillStyle = '#111827';
  ctx.fillRect(x - 4, y - 4, sw + 8, sh + 8);
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, sw, sh);
  if (image) ctx.drawImage(image, x, y, sw, sh);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x, y + sh * 0.8, sw, sh * 0.2);
  ctx.fillStyle = '#ecfeff';
  ctx.font = `${Math.round(h * 0.022)}px sans-serif`;
  ctx.fillText(title, x + 4, y + sh * 0.95);
}
