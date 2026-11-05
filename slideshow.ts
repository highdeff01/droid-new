import type { Frame } from './types.js';
import { parseJsonReply, type AskFn } from './ai.js';
import { uid } from './planner.js';
import { decodableImage } from './presentation.js';

/** What a slide is composed from: a screenshot, a preferred frame (wins over screenshots), a note or a research finding. */
export type SlideItem =
  | { kind: 'screenshot'; frame: Frame }
  | { kind: 'frame'; frame: Frame }
  | { kind: 'note'; text: string }
  | { kind: 'research'; text: string; source?: string };

/** How a slide enters the screen. */
export const TRANSITIONS = ['cut', 'fade', 'slide', 'zoom'] as const;
export type Transition = (typeof TRANSITIONS)[number];

/** How long a transition runs at the start of a slide. */
export const TRANSITION_MS = 600;
/** How long a slide stays when its spec gives no duration. */
export const DEFAULT_SLIDE_MS = 4000;
/** Most slides one slideshow holds. */
export const MAX_SLIDES = 30;

/** One slide as requested: a title, what it is composed from, and how it is shown. */
export interface SlideSpec {
  title: string;
  items: SlideItem[];
  transition?: Transition;
  durationMs?: number;
}

/** One research finding on a slide, with where it came from. */
export interface Finding {
  text: string;
  source?: string;
}

/** One assembled slide. */
export interface ShowSlide {
  id: string;
  title: string;
  /** The image shown: the preferred frame when there is one, else the first screenshot, else none. */
  image: string | null;
  imageFrom: 'frame' | 'screenshot' | null;
  notes: string[];
  research: Finding[];
  transition: Transition;
  durationMs: number;
}

/** A slideshow: 'verified' only once the follow-up checks passed every slide. */
export interface Slideshow {
  id: string;
  name: string;
  created: number;
  slides: ShowSlide[];
  status: 'draft' | 'verified' | 'incomplete';
}

const firstFrame = (items: SlideItem[], kind: 'frame' | 'screenshot') => {
  const hit = items.find((i): i is Extract<SlideItem, { kind: 'frame' | 'screenshot' }> => i.kind === kind);
  return hit ? hit.frame.url : null;
};

const texts = (items: SlideItem[], kind: 'note') => items.flatMap((i) => (i.kind === kind && i.text.trim() ? [i.text.trim()] : []));
const findings = (items: SlideItem[]): Finding[] => items.flatMap((i) => (i.kind === 'research' && i.text.trim() ? [{ text: i.text.trim(), ...(i.source ? { source: i.source } : {}) }] : []));

/** One slide from its spec: preferred frame over screenshot, blank notes dropped, default transition and duration. */
export function assembleSlide(spec: SlideSpec, fallback: Transition = 'fade'): ShowSlide {
  const preferred = firstFrame(spec.items, 'frame');
  const image = preferred ?? firstFrame(spec.items, 'screenshot');
  return {
    id: uid('slide'),
    title: spec.title.trim(),
    image,
    imageFrom: preferred ? 'frame' : image ? 'screenshot' : null,
    notes: texts(spec.items, 'note'),
    research: findings(spec.items),
    transition: spec.transition ?? fallback,
    durationMs: spec.durationMs && spec.durationMs > 0 ? spec.durationMs : DEFAULT_SLIDE_MS,
  };
}

const empty = (s: ShowSlide) => !s.image && !s.notes.length && !s.research.length;

/** A draft slideshow of `specs` (empty slides dropped, at most MAX_SLIDES); throws when nothing is left to show. */
export function assembleSlideshow(name: string, specs: SlideSpec[], transition: Transition = 'fade', now = Date.now()): Slideshow {
  const slides = specs.map((s) => assembleSlide(s, transition)).filter((s) => !empty(s)).slice(0, MAX_SLIDES);
  if (!slides.length) throw new Error('nothing to show — every slide has no image, notes or research');
  return { id: uid('show'), name: name.trim() || 'Slideshow', created: now, slides, status: 'draft' };
}

/** Total running time of a slideshow. */
export const showDuration = (show: Slideshow) => show.slides.reduce((t, s) => t + s.durationMs, 0);

/** Where playback is at `elapsedMs`: the slide index, progress through it and through its transition; null once it ended. */
export function playbackAt(show: Slideshow, elapsedMs: number): { index: number; progress: number; transition: number } | null {
  let start = 0;
  for (const [index, slide] of show.slides.entries()) {
    const into = elapsedMs - start;
    if (into < slide.durationMs) {
      const t = Math.max(0, into);
      return { index, progress: t / slide.durationMs, transition: slide.transition === 'cut' ? 1 : Math.min(1, t / TRANSITION_MS) };
    }
    start += slide.durationMs;
  }
  return null;
}

/** The style of a slide `t` (0..1) through its entering transition. */
export const TRANSITION_STYLE: Record<Transition, (t: number) => { opacity: number; transform: string }> = {
  cut: () => ({ opacity: 1, transform: 'none' }),
  fade: (t) => ({ opacity: t, transform: 'none' }),
  slide: (t) => ({ opacity: 1, transform: `translateX(${Math.round((1 - t) * 100)}%)` }),
  zoom: (t) => ({ opacity: t, transform: `scale(${(0.8 + 0.2 * t).toFixed(3)})` }),
};

/** The result of one slide's follow-up check. */
export interface SlideCheck {
  ok: boolean;
  reason: string;
}

/** The AI's answer whether a slide's image shows what its title says; null when the AI is offline. */
export type SlideConfirm = ((slide: ShowSlide) => Promise<SlideCheck>) | null;

/** Follow-up check of one slide: a title, something to show, a decodable image, and the AI's confirmation of the image when online. */
export async function checkSlide(slide: ShowSlide, confirm: SlideConfirm): Promise<SlideCheck> {
  if (!slide.title) return { ok: false, reason: 'slide has no title' };
  if (empty(slide)) return { ok: false, reason: `"${slide.title}" has no image, notes or research` };
  if (!slide.image) return { ok: true, reason: `"${slide.title}" is text only (${slide.notes.length} note(s), ${slide.research.length} finding(s))` };
  if (!decodableImage(slide.image)) return { ok: false, reason: `"${slide.title}" image is not a decodable image` };
  if (!confirm) return { ok: true, reason: `"${slide.title}" image decodes (AI offline — content not confirmed)` };
  return confirm(slide);
}

const CONFIRM_SYSTEM = 'You verify slideshow slides. Say whether the image shows what the slide title and notes describe. Reply ONLY with JSON {"shown":boolean,"reason":string}.';

/** A SlideConfirm that asks the model about the slide's image. */
export const askSlideConfirm = (ask: AskFn, frameOf: (slide: ShowSlide) => Frame | null): NonNullable<SlideConfirm> => async (slide) => {
  const { content } = await ask({ system: CONFIRM_SYSTEM, prompt: `Slide title: ${slide.title}\nNotes: ${slide.notes.join('; ') || '(none)'}`, frame: frameOf(slide), json: true });
  const r = parseJsonReply(content);
  const reason = typeof r.reason === 'string' ? r.reason : '';
  return { ok: r.shown === true, reason: `AI ${r.shown === true ? 'confirmed' : 'did NOT confirm'} "${slide.title}": ${reason}` };
};

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

function slideHtml(slide: ShowSlide, index: number): string {
  const img = slide.image ? `<img src="${esc(slide.image)}" alt="${esc(slide.title)}">` : '';
  const notes = slide.notes.map((n) => `<li>${esc(n)}</li>`).join('');
  const research = slide.research.map((r) => `<li class="research">${esc(r.text)}${r.source ? ` <cite>${esc(r.source)}</cite>` : ''}</li>`).join('');
  return `<section class="slide t-${slide.transition}" data-ms="${slide.durationMs}" data-index="${index}"><h2>${esc(slide.title)}</h2>${img}<ul>${notes}${research}</ul></section>`;
}

const EXPORT_STYLE = `body{margin:0;background:#0f172a;color:#e2e8f0;font-family:sans-serif}.slide{position:absolute;inset:0;padding:4vh 6vw;opacity:0;transition:opacity ${TRANSITION_MS}ms,transform ${TRANSITION_MS}ms}.slide.on{opacity:1;transform:none}.t-cut{transition:none}.t-slide{transform:translateX(100%)}.t-zoom{transform:scale(.8)}img{max-width:100%;max-height:60vh}cite{color:#94a3b8}`;
const EXPORT_SCRIPT = `const s=[...document.querySelectorAll('.slide')];let i=0;const show=()=>{s.forEach((e,k)=>e.classList.toggle('on',k===i));setTimeout(()=>{i=(i+1)%s.length;show();},+s[i].dataset.ms);};show();`;

/** The slideshow as one self-contained HTML file that plays itself with its transitions. */
export function slideshowHtml(show: Slideshow): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(show.name)}</title><style>${EXPORT_STYLE}</style></head><body>${show.slides.map(slideHtml).join('')}<script>${EXPORT_SCRIPT}</script></body></html>`;
}

/** One-line text of a slideshow for the log and notifications. */
export const slideshowText = (show: Slideshow) => `Slideshow "${show.name}" ${show.status.toUpperCase()} — ${show.slides.length} slide(s), ${Math.round(showDuration(show) / 1000)}s`;
