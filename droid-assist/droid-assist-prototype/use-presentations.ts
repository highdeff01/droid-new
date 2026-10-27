import { useRef, useState } from 'react';
import type { WorkflowStep } from './types.js';
import { uid } from './planner.js';
import { downloadText } from './action-history.js';
import { loadArtifacts, saveArtifacts, upsertArtifact } from './artifact-store.js';
import type { CapabilityResult } from './capability-registry.js';
import { runSteps, useStore } from './use-capabilities.js';
import { findOutput, parseAction, presentationCaps, runPresentation, type ActionKind, type CompositionApproval, type PresentationDeps, type PresentationStores } from './presentation-caps.js';
import { addNotification, createNotification, dismissNotification, markRead, type NotifyInput, type RichNotification } from './rich-notifications.js';
import { slideshowHtml } from './slideshow.js';
import { recordMovie } from './movie.js';
import { worldEmbed, type OutputKind, type WorldEmbed } from './presentation-project.js';

const ACTOR = 'Presentations';
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fileName = (name: string, ext: string) => `${name.replace(/[^\w-]+/g, '-').toLowerCase() || 'presentation'}.${ext}`;

/** A browser image loaded from a data URL, for movie export. */
async function loadImage(url: string): Promise<CanvasImageSource> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** The movie as a webm download; throws with the reason when the browser cannot record. */
async function exportMovieFile(movie: Parameters<typeof recordMovie>[0]): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const blob = await recordMovie(movie, { canvas, loadImage, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(movie.name, 'webm');
  a.click();
  URL.revokeObjectURL(url);
}

/** What the presentation studio drives in the engine: the capability deps without the notification sink it owns. */
export type UsePresentationDeps = Omit<PresentationDeps, 'notify'>;

/** State that running capabilities read as of now: the rendered value, a live getter and a setter. */
function useLive<T>(initial: T) {
  const [value, setValue] = useState<T>(initial);
  const ref = useRef(value);
  const set = (next: T) => {
    ref.current = next;
    setValue(next);
  };
  return { value, get: () => ref.current, set };
}

/**
 * The presentation studio: slideshows, movies and projects (persisted), the composition approval
 * queue for main-AI/agent requests, rich notifications and the in-world screen embed.
 */
export function usePresentations(deps: UsePresentationDeps) {
  const slideshows = useStore(() => loadArtifacts('slideshows'), (l) => saveArtifacts('slideshows', l));
  const movies = useStore(() => loadArtifacts('movies'), (l) => saveArtifacts('movies', l));
  const projects = useStore(() => loadArtifacts('projects'), (l) => saveArtifacts('projects', l));
  const [notifications, setNotifications] = useState<RichNotification[]>([]);
  const approvals = useLive<CompositionApproval[]>([]);
  const embed = useLive<WorldEmbed | null>(null);
  const [playing, setPlaying] = useState<{ kind: OutputKind; id: string } | null>(null);

  const notify = (n: NotifyInput) => setNotifications((list) => addNotification(list, createNotification(n)));
  const commitApprovals = approvals.set;
  const showEmbed = embed.set;
  const full: PresentationDeps = { ...deps, notify };
  const stores: PresentationStores = {
    slideshows: () => slideshows.ref.current,
    saveSlideshow: (s) => slideshows.commit(upsertArtifact(slideshows.ref.current, s)),
    movies: () => movies.ref.current,
    saveMovie: (m) => movies.commit(upsertArtifact(movies.ref.current, m)),
    projects: () => projects.ref.current,
    saveProjects: projects.commit,
    embed: showEmbed,
    queue: (a) => commitApprovals([...approvals.get(), a]),
  };

  /** Runs an approved composition with the user's authority; the request leaves the queue either way. */
  /** Removes approval `id` from the queue and returns it; null when it is not queued. */
  const take = (id: string): CompositionApproval | null => {
    const a = approvals.get().find((x) => x.id === id) ?? null;
    if (a) commitApprovals(approvals.get().filter((x) => x.id !== id));
    return a;
  };
  const approve = async (id: string): Promise<CapabilityResult | null> => {
    const a = take(id);
    if (!a) return null;
    deps.log(ACTOR, `Approved — ${a.briefing}`, 'info');
    const r = await runPresentation(full, stores, a.capability, a.params);
    deps.log(ACTOR, `${a.capability}: ${r.message}`, r.ok ? 'ok' : 'error');
    return r;
  };
  const reject = (id: string) => {
    const a = take(id);
    if (a) deps.log(ACTOR, `Rejected — ${a.briefing}`, 'warn');
  };

  /** Downloads a saved slideshow as HTML or a movie as webm. */
  const exportOutput = async (ref: string) => {
    const show = slideshows.ref.current.find((s) => s.id === ref);
    if (show) return downloadText(fileName(show.name, 'html'), slideshowHtml(show), 'text/html');
    const movie = movies.ref.current.find((m) => m.id === ref);
    if (!movie) return deps.log(ACTOR, `Nothing saved with id ${ref} to export`, 'warn');
    try {
      await exportMovieFile(movie);
      deps.log(ACTOR, `Exported movie "${movie.name}" as webm`, 'ok');
    } catch (error) {
      deps.log(ACTOR, `Movie export failed — ${errorText(error)}`, 'error');
    }
  };

  /** Shows a saved presentation on the in-world screen of the demo game. */
  const embedOutput = (ref: string) => {
    const out = findOutput(stores, ref);
    if (!out) return deps.log(ACTOR, `Nothing saved with id ${ref} to embed`, 'warn');
    try {
      showEmbed(worldEmbed(out.id, out.kind, out.name, out.images));
      deps.log(ACTOR, `"${out.name}" is on the in-world screen`, 'ok');
    } catch (error) {
      deps.log(ACTOR, errorText(error), 'warn');
    }
  };

  /** Opens a connected app on the PC: an input step on the briefed real-input path (dry run unless armed). */
  const openApp = async (app: string) => {
    const step: WorkflowStep = { id: uid('step'), name: `Open ${app}`, action: 'open_app', text: app, x: 0.5, y: 0.5, status: 'pending' };
    const r = await runSteps(deps, `Notification: open ${app}`, [step]);
    deps.log(ACTOR, r.message, r.ok ? 'ok' : 'error');
  };

  const findKind = (ref: string): OutputKind => (slideshows.ref.current.some((s) => s.id === ref) ? 'slideshow' : 'movie');
  /** What each notification button does. */
  const ACTIONS: Record<ActionKind, (ref: string) => unknown> = {
    approve: (ref) => approve(ref),
    reject,
    play: (ref) => setPlaying({ kind: findKind(ref), id: ref }),
    export: exportOutput,
    embed: embedOutput,
    'open-app': openApp,
  };

  /** Runs notification `id`'s button `actionId` and marks the notification read. */
  const act = (id: string, actionId: string) => {
    const a = parseAction(actionId);
    setNotifications((list) => markRead(list, id));
    if (a) void ACTIONS[a.kind](a.ref);
  };

  return {
    capabilities: presentationCaps(full, stores),
    slideshows: slideshows.list, movies: movies.list, projects: projects.list,
    notifications, approvals: approvals.value, embed: embed.value, playing,
    /** The embed as of now, for the demo render loop (reads outside render). */
    currentEmbed: embed.get,
    approve, reject, act, exportOutput, embedOutput, setPlaying, clearEmbed: () => showEmbed(null),
    dismiss: (id: string) => setNotifications((list) => dismissNotification(list, id)),
    read: (id: string) => setNotifications((list) => markRead(list, id)),
  };
}
