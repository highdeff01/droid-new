import type { Frame, LogEntry } from './types.js';
import { parseJsonReply, type AskFn } from './ai.js';
import type { StageId } from './loop-control.js';
import { uid } from './planner.js';
import { decodableImage } from './presentation.js';
import type { Caller, Capability, CapabilityResult, Params } from './capability-registry.js';
import { callerName, param, type RunDeps } from './use-capabilities.js';
import { TRANSITIONS, askSlideConfirm, assembleSlideshow, checkSlide, slideshowText, type ShowSlide, type SlideItem, type SlideSpec, type Slideshow, type Transition } from './slideshow.js';
import { assembleMovie, movieText, type Movie, type ShotSource } from './movie.js';
import { followUpText, runFollowUp, type FollowUpReport } from './follow-up.js';
import { gatherSources, parseSourceRequests, type Got, type SourceDeps, type SourceRequest } from './presentation-sources.js';
import { addToProject, worldEmbed, type OutputKind, type PresentationProject, type WorldEmbed } from './presentation-project.js';
import type { NotifyAction, NotifyInput } from './rich-notifications.js';

/** The presentation capabilities. */
export const PRESENTATION_CAPS = ['slideshow.build', 'movie.render', 'presentation.add-to-project', 'presentation.embed'] as const;
export type PresentationCapId = (typeof PRESENTATION_CAPS)[number];

/** A composition the main AI or an agent asked for, waiting for the user's approval: its briefing and parameters. */
export interface CompositionApproval {
  id: string;
  capability: PresentationCapId;
  params: Params;
  caller: string;
  /** The composition briefing: what is composed, from which sources, in which mode. */
  briefing: string;
  created: number;
}

/** What the presentation capabilities drive in the engine. */
export interface PresentationDeps extends RunDeps {
  sources: SourceDeps;
  /** The comparison gallery, newest first: preferred frames and run-replay material. */
  frames: () => Frame[];
  ask: (stage: StageId) => AskFn | null;
  log: (from: string, message: string, tone?: LogEntry['tone']) => void;
  notify: (n: NotifyInput) => void;
}

/** Where presentations, projects, the world embed and pending approvals are kept. */
export interface PresentationStores {
  slideshows: () => Slideshow[];
  saveSlideshow: (s: Slideshow) => void;
  movies: () => Movie[];
  saveMovie: (m: Movie) => void;
  projects: () => PresentationProject[];
  saveProjects: (list: PresentationProject[]) => void;
  embed: (e: WorldEmbed) => void;
  queue: (a: CompositionApproval) => void;
}

/** What a notification button does; its id is `<kind>:<ref>`. */
export const ACTION_KINDS = ['approve', 'reject', 'play', 'export', 'embed', 'open-app'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** A notification button of `kind` acting on `ref`; open-app drives the PC, so it is an input action. */
export const notifyAction = (kind: ActionKind, ref: string, label: string): NotifyAction => ({ id: `${kind}:${ref}`, label, ...(kind === 'open-app' ? { input: true } : {}) });

/** The kind and ref of a notification button id; null for an unknown kind. */
export function parseAction(id: string): { kind: ActionKind; ref: string } | null {
  const cut = id.indexOf(':');
  const kind = ACTION_KINDS.find((k) => k === id.slice(0, cut));
  return kind && cut > 0 ? { kind, ref: id.slice(cut + 1) } : null;
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const lines = (v: unknown) => (Array.isArray(v) ? v.map(String).filter((s) => s.trim()) : []);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fail = (message: string): CapabilityResult => ({ ok: false, message });
const skippedText = (skipped: string[]) => (skipped.length ? ` · ${skipped.join('; ')}` : '');

const RESEARCH_SYSTEM = 'You do side research for a presentation. Give the key facts about the topic as short findings. Reply ONLY with JSON {"findings":string[]}.';

/** The web source: findings about `topic` from the model; offline when there is no AI. */
export const askResearch = (ask: AskFn | null) => async (topic: string): Promise<Got<string[]>> => {
  if (!ask) return { ok: false, reason: 'AI offline — no side research' };
  const { content } = await ask({ system: RESEARCH_SYSTEM, prompt: `Topic: ${topic}`, json: true });
  return { ok: true, value: lines(parseJsonReply(content).findings) };
};

/** Slide items of one requested slide: notes, research, the latest screenshot and a preferred gallery frame. */
function slideItems(r: Record<string, unknown>, frames: Frame[]): SlideItem[] {
  const preferred = frames.find((f) => f.id === r.frame);
  return [
    ...lines(r.notes).map((text): SlideItem => ({ kind: 'note', text })),
    ...lines(r.research).map((text): SlideItem => ({ kind: 'research', text })),
    ...(r.screenshot === true && frames[0] ? [{ kind: 'screenshot', frame: frames[0] } as SlideItem] : []),
    ...(preferred ? [{ kind: 'frame', frame: preferred } as SlideItem] : []),
  ];
}

const transitionOf = (v: unknown): Transition | undefined => TRANSITIONS.find((t) => t === v);

/** The slides requested directly in `raw`. */
function requestedSlides(raw: unknown, frames: Frame[]): SlideSpec[] {
  return (Array.isArray(raw) ? raw : []).map((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    const transition = transitionOf(r.transition);
    return { title: str(r.title), items: slideItems(r, frames), ...(transition ? { transition } : {}) };
  });
}

/** The frame each slide image came from, for the AI's confirmation. */
function frameLookup(specs: SlideSpec[]): (slide: ShowSlide) => Frame | null {
  const byUrl = new Map(specs.flatMap((s) => s.items.flatMap((i) => (i.kind === 'frame' || i.kind === 'screenshot' ? [[i.frame.url, i.frame] as const] : []))));
  return (slide) => (slide.image ? byUrl.get(slide.image) ?? null : null);
}

/** "Open <app>" buttons for the connected apps a presentation drew on. */
const appActions = (requests: SourceRequest[]) => requests.flatMap((r) => (r.kind === 'app' && r.subject ? [notifyAction('open-app', r.subject, `Open ${r.subject} on the PC`)] : []));

/** The notification of a finished follow-up run. */
function followUpNotice(topic: OutputKind, name: string, report: FollowUpReport, image: string | undefined, actions: NotifyAction[]): NotifyInput {
  return { topic, severity: report.done ? 'success' : 'warning', title: `Follow-up checks of "${name}" ${report.done ? 'passed' : 'left work open'}`, body: followUpText(name, report), ...(image ? { image } : {}), actions };
}

/** slideshow.build: gathers sources, assembles, runs the follow-up checks per slide and saves the slideshow. */
async function buildSlideshow(deps: PresentationDeps, stores: PresentationStores, p: Params): Promise<CapabilityResult> {
  const requests = parseSourceRequests(p.sources);
  const gathered = await gatherSources(requests, deps.sources);
  const specs = [...requestedSlides(p.slides, deps.frames()), ...gathered.specs];
  let show: Slideshow;
  try {
    show = assembleSlideshow(str(p.name), specs, transitionOf(p.transition));
  } catch (error) {
    return fail(`slideshow.build refused — ${errorText(error)}${skippedText(gathered.skipped)}`);
  }
  const image = show.slides.find((s) => s.image)?.image ?? undefined;
  deps.notify({ topic: 'slideshow', severity: 'info', title: `Slideshow "${show.name}" assembled`, body: `${show.slides.length} slide(s), now running follow-up checks${skippedText(gathered.skipped)}`, ...(image ? { image } : {}) });
  const ask = deps.ask('verdict');
  const confirm = ask ? askSlideConfirm(ask, frameLookup(specs)) : null;
  const report = await runFollowUp(show.slides, (s) => s.title, (s) => checkSlide(s, confirm));
  const done: Slideshow = { ...show, status: report.done ? 'verified' : 'incomplete' };
  stores.saveSlideshow(done);
  const actions = [notifyAction('play', done.id, 'Play'), notifyAction('export', done.id, 'Export HTML'), notifyAction('embed', done.id, 'Show in the demo world'), ...appActions(requests)];
  deps.notify(followUpNotice('slideshow', done.name, report, image, actions));
  return { ok: report.done, message: `${slideshowText(done)} · ${followUpText(done.name, report)}${skippedText(gathered.skipped)}`, data: done };
}

/** The shots of a movie: a saved slideshow's images, the newest gallery frames and the gathered sources' screenshots. */
function movieShots(p: Params, deps: PresentationDeps, stores: PresentationStores, specs: SlideSpec[]): ShotSource[] {
  const show = p.slideshow === undefined ? null : findSaved(stores.slideshows(), str(p.slideshow));
  const fromShow = (show?.slides ?? []).flatMap((s) => (s.image ? [{ image: s.image, caption: s.title }] : []));
  const count = typeof p.frames === 'number' ? p.frames : p.slideshow === undefined && !specs.length ? Infinity : 0;
  const fromGallery = deps.frames().slice(0, count).reverse().map((f) => ({ image: f.url, caption: new Date(f.time).toLocaleTimeString() }));
  const fromSources = specs.flatMap((s) => s.items.flatMap((i) => (i.kind === 'frame' || i.kind === 'screenshot' ? [{ image: i.frame.url, caption: s.title }] : [])));
  return [...fromShow, ...fromGallery, ...fromSources];
}

/** movie.render: collects shots, assembles the movie, checks every shot and saves it (exported from the studio). */
async function renderMovie(deps: PresentationDeps, stores: PresentationStores, p: Params): Promise<CapabilityResult> {
  const gathered = await gatherSources(parseSourceRequests(p.sources), deps.sources);
  let movie: Movie;
  try {
    movie = assembleMovie(str(p.name), movieShots(p, deps, stores, gathered.specs), typeof p.holdMs === 'number' ? { holdMs: p.holdMs } : {});
  } catch (error) {
    return fail(`movie.render refused — ${errorText(error)}${skippedText(gathered.skipped)}`);
  }
  const shots = movie.shots.map((s, i) => ({ id: `shot-${i + 1}`, ...s }));
  const report = await runFollowUp(shots, (s) => s.caption ?? s.id, async (s) => (decodableImage(s.image) ? { ok: true, reason: `${s.id} decodes` } : { ok: false, reason: `${s.id} is not a decodable image` }));
  const done: Movie = { ...movie, status: report.done ? 'verified' : 'incomplete' };
  stores.saveMovie(done);
  deps.notify({ topic: 'movie', severity: report.done ? 'success' : 'warning', title: `Movie "${done.name}" rendered`, body: `${movieText(done)} · ${followUpText(done.name, report)}`, image: done.shots[0].image, actions: [notifyAction('play', done.id, 'Play'), notifyAction('embed', done.id, 'Show in the demo world')] });
  return { ok: report.done, message: `${movieText(done)} · ${followUpText(done.name, report)}${skippedText(gathered.skipped)}`, data: done };
}

const findSaved = <T extends { id: string; name: string }>(list: T[], ref: string) => list.find((x) => x.id === ref) ?? list.find((x) => x.name.trim().toLowerCase() === ref.trim().toLowerCase()) ?? null;

/** A saved slideshow or movie by id or name, with the images it shows. */
export function findOutput(stores: Pick<PresentationStores, 'slideshows' | 'movies'>, ref: string): { id: string; kind: OutputKind; name: string; images: string[] } | null {
  const show = findSaved(stores.slideshows(), ref);
  if (show) return { id: show.id, kind: 'slideshow', name: show.name, images: show.slides.flatMap((s) => (s.image ? [s.image] : [])) };
  const movie = findSaved(stores.movies(), ref);
  return movie ? { id: movie.id, kind: 'movie', name: movie.name, images: movie.shots.map((s) => s.image) } : null;
}

/** presentation.add-to-project: appends a saved presentation to a project (created by name when missing). */
async function addPresentation(deps: PresentationDeps, stores: PresentationStores, p: Params): Promise<CapabilityResult> {
  const out = findOutput(stores, str(p.presentation));
  if (!out) return fail(`presentation.add-to-project refused — no saved slideshow or movie "${str(p.presentation)}"`);
  const r = addToProject(stores.projects(), str(p.project), { id: out.id, kind: out.kind, name: out.name, added: Date.now() });
  stores.saveProjects(r.projects);
  const message = r.added ? `Added "${out.name}" to project "${r.project.name}" (${r.project.presentations.length} presentation(s))` : `"${out.name}" is already in project "${r.project.name}"`;
  deps.notify({ topic: 'project', severity: 'success', title: `"${out.name}" in project "${r.project.name}"`, body: message, ...(out.images[0] ? { image: out.images[0] } : {}) });
  return { ok: true, message, data: r.project };
}

/** presentation.embed: shows a saved presentation on the in-world screen of the demo game. */
async function embedPresentation(deps: PresentationDeps, stores: PresentationStores, p: Params): Promise<CapabilityResult> {
  const out = findOutput(stores, str(p.presentation));
  if (!out) return fail(`presentation.embed refused — no saved slideshow or movie "${str(p.presentation)}"`);
  let embed: WorldEmbed;
  try {
    embed = worldEmbed(out.id, out.kind, out.name, out.images);
  } catch (error) {
    return fail(`presentation.embed refused — ${errorText(error)}`);
  }
  stores.embed(embed);
  const message = `"${out.name}" is on the in-world screen of the demo game (${embed.images.length} image(s))`;
  deps.notify({ topic: 'embed', severity: 'success', title: `"${out.name}" embedded in the demo world`, body: message, image: embed.images[0] });
  return { ok: true, message, data: embed };
}

type Runner = (deps: PresentationDeps, stores: PresentationStores, p: Params) => Promise<CapabilityResult>;

/** Each presentation capability: its description, parameters and what running it does. */
const SPECS: Record<PresentationCapId, { description: string; params: Capability['params']; run: Runner }> = {
  'slideshow.build': {
    description: 'Compose a slideshow from screenshots, notes, research and preferred gallery frames, plus sources (connected app via the main-app bridge, web research, the PC screen, the demo world); transitions; follow-up checks every slide; AI requests wait for user approval',
    params: [param('name', 'string', true, 'slideshow name'), param('slides', 'array', false, 'slides: {title, notes?: string[], research?: string[], screenshot?: boolean, frame?: gallery frame id, transition?}'), param('sources', 'array', false, 'sources: {kind: app|web|pc|demo, subject?, title?}'), param('transition', 'string', false, TRANSITIONS.join('|'))],
    run: buildSlideshow,
  },
  'movie.render': {
    description: 'Render a short movie from captured frames and screenshots (run replay by default, a saved slideshow, or sources); follow-up checks every shot; AI requests wait for user approval',
    params: [param('name', 'string', true, 'movie name'), param('frames', 'number', false, 'newest gallery frames to use'), param('slideshow', 'string', false, 'saved slideshow to render'), param('sources', 'array', false, 'sources: {kind: app|web|pc|demo, subject?, title?}'), param('holdMs', 'number', false, 'ms per shot')],
    run: renderMovie,
  },
  'presentation.add-to-project': {
    description: 'Add a saved slideshow or movie to an existing project (created when missing); AI requests wait for user approval',
    params: [param('presentation', 'string', true, 'slideshow or movie name/id'), param('project', 'string', true, 'project name')],
    run: addPresentation,
  },
  'presentation.embed': {
    description: 'Show a saved slideshow or movie on the in-world screen of the demo game; AI requests wait for user approval',
    params: [param('presentation', 'string', true, 'slideshow or movie name/id')],
    run: embedPresentation,
  },
};

/** The composition briefing of a request: what, from which sources, in which mode. */
export function compositionBriefing(id: PresentationCapId, p: Params, caller: Caller): string {
  const sources = parseSourceRequests(p.sources).map((s) => (s.subject ? `${s.kind} "${s.subject}"` : s.kind));
  const what = str(p.name) || str(p.presentation);
  const where = str(p.project) ? ` into project "${str(p.project)}"` : '';
  return `${callerName(caller)} asks for ${id}: "${what}"${where} · sources: ${sources.join(', ') || 'gallery / given slides'}`;
}

/** Runs presentation capability `id` with the user's authority (direct invoke or an approved request). */
export const runPresentation = (deps: PresentationDeps, stores: PresentationStores, id: PresentationCapId, p: Params) => SPECS[id].run(deps, stores, p);

/** Queues an AI request as a composition approval and raises its notification. */
function queueApproval(deps: PresentationDeps, stores: PresentationStores, id: PresentationCapId, p: Params, caller: Caller): CapabilityResult {
  const a: CompositionApproval = { id: uid('approval'), capability: id, params: p, caller: callerName(caller), briefing: compositionBriefing(id, p, caller), created: Date.now() };
  stores.queue(a);
  deps.notify({ topic: 'approval', severity: 'warning', title: `Approval needed: ${id}`, body: a.briefing, actions: [notifyAction('approve', a.id, 'Approve'), notifyAction('reject', a.id, 'Reject')] });
  return { ok: true, message: `Awaiting your approval — ${a.briefing}`, data: a };
}

/** The presentation capabilities: the user runs them directly; the main AI and agents queue an approval first. */
export function presentationCaps(deps: PresentationDeps, stores: PresentationStores): Capability[] {
  return PRESENTATION_CAPS.map((id) => ({
    id, access: 'all', description: SPECS[id].description, params: SPECS[id].params,
    invoke: (p, caller) => (caller.kind === 'user' ? runPresentation(deps, stores, id, p) : Promise.resolve(queueApproval(deps, stores, id, p, caller))),
  }));
}
