import type { Frame } from './types.js';
import { parseJsonReply, type AskFn } from './ai.js';
import { uid } from './planner.js';

/** What one slide is composed from: a title, notes, research results and optionally a screenshot. */
export interface SlideSource {
  title: string;
  notes?: string[];
  research?: string[];
  /** The screenshot the slide shows; its pixels are checked before the slide is accepted. */
  shot?: Frame | null;
}

/** State of one follow-up check: passed, failed, skipped (nothing to check) or not yet run. */
export type CheckState = 'pass' | 'fail' | 'skipped' | 'pending';

/** One composed slide with its two follow-up checks and why each ended as it did. */
export interface Slide {
  id: string;
  title: string;
  notes: string[];
  research: string[];
  /** The screenshot's display JPEG data URL, or null for a slide without one. */
  screenshot: string | null;
  checks: { screenshot: CheckState; completeness: CheckState };
  detail: string[];
}

/** A presentation artifact: 'done' only once every slide passed its checks, 'incomplete' when one did not. */
export interface Presentation {
  id: string;
  name: string;
  created: number;
  slides: Slide[];
  status: 'draft' | 'done' | 'incomplete';
}

/** The AI's answer whether a slide's screenshot shows what the slide is about. */
export type ShotConfirm = (slide: Slide, shot: Frame) => Promise<{ shown: boolean; reason: string }>;

const clean = (lines: string[] | undefined) => (lines ?? []).map((l) => l.trim()).filter(Boolean);

/** A slide from its source, both checks pending. */
export function composeSlide(src: SlideSource): Slide {
  return { id: uid('slide'), title: src.title.trim(), notes: clean(src.notes), research: clean(src.research), screenshot: src.shot?.url ?? null, checks: { screenshot: 'pending', completeness: 'pending' }, detail: [] };
}

/** A draft presentation of `sources`, one slide each. */
export function buildSlides(name: string, sources: SlideSource[], now = Date.now()): Presentation {
  return { id: uid('pres'), name: name.trim(), created: now, slides: sources.map(composeSlide), status: 'draft' };
}

/** Completeness: a slide needs a title and at least one note or research line. */
export function completeness(slide: Slide): { ok: boolean; reason: string } {
  if (!slide.title) return { ok: false, reason: 'slide has no title' };
  if (!slide.notes.length && !slide.research.length) return { ok: false, reason: `"${slide.title}" has no notes or research results` };
  return { ok: true, reason: `"${slide.title}" has ${slide.notes.length} note(s) and ${slide.research.length} research line(s)` };
}

/** Whether a data URL holds a non-empty image payload. */
export const decodableImage = (url: string) => /^data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]{16,}$/.test(url);

/** The screenshot check: skipped without a screenshot; otherwise a decodable image, confirmed by the AI when it is given. */
export async function screenshotCheck(slide: Slide, shot: Frame | null, confirm: ShotConfirm | null): Promise<{ state: CheckState; reason: string }> {
  if (!shot || !slide.screenshot) return { state: 'skipped', reason: 'no screenshot on this slide — screenshot check skipped' };
  if (!decodableImage(slide.screenshot)) return { state: 'fail', reason: 'screenshot is not a decodable image' };
  if (!confirm) return { state: 'pass', reason: 'screenshot decodes (AI offline — content not confirmed)' };
  const r = await confirm(slide, shot);
  return { state: r.shown ? 'pass' : 'fail', reason: `AI ${r.shown ? 'confirmed' : 'did NOT confirm'} the screenshot shows "${slide.title}": ${r.reason}` };
}

/** Runs both follow-up checks of one slide. */
export async function verifySlide(slide: Slide, shot: Frame | null, confirm: ShotConfirm | null): Promise<Slide> {
  const s = await screenshotCheck(slide, shot, confirm);
  const c = completeness(slide);
  return { ...slide, checks: { screenshot: s.state, completeness: c.ok ? 'pass' : 'fail' }, detail: [s.reason, c.reason] };
}

const slidePassed = (s: Slide) => (s.checks.screenshot === 'pass' || s.checks.screenshot === 'skipped') && s.checks.completeness === 'pass';

/** The presentation with its verified slides: 'done' only when every slide passed, else 'incomplete'. */
export function finishPresentation(p: Presentation, slides: Slide[]): Presentation {
  return { ...p, slides, status: slides.length && slides.every(slidePassed) ? 'done' : 'incomplete' };
}

/** One-line text of a presentation for the log. */
export function presentationText(p: Presentation): string {
  const passed = p.slides.filter(slidePassed).length;
  return `Presentation "${p.name}" ${p.status.toUpperCase()} — ${passed}/${p.slides.length} slide(s) verified`;
}

const CONFIRM_SYSTEM = 'You verify presentation slides. Look at the screenshot and say whether it shows what the slide title describes. Reply ONLY with JSON {"shown":boolean,"reason":string}.';

/** A ShotConfirm that asks the model about the screenshot. */
export const askShotConfirm = (ask: AskFn): ShotConfirm => async (slide, shot) => {
  const { content } = await ask({ system: CONFIRM_SYSTEM, prompt: `Slide title: ${slide.title}\nNotes: ${slide.notes.join('; ') || '(none)'}`, frame: shot, json: true });
  const r = parseJsonReply(content);
  return { shown: r.shown === true, reason: typeof r.reason === 'string' ? r.reason : '' };
};
