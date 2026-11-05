import type { Frame } from './types.js';
import type { SlideItem, SlideSpec } from './slideshow.js';

/**
 * Where presentation material comes from: a connected app (its window via the main-app bridge),
 * the web (AI side research), the user's PC (live screen, read-only) or the virtual demo environment.
 */
export const SOURCE_KINDS = ['app', 'web', 'pc', 'demo'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** One requested source: its kind, the app to capture or the topic to research, and an optional slide title. */
export interface SourceRequest {
  kind: SourceKind;
  /** The connected app (app) or the research topic (web). */
  subject?: string;
  title?: string;
}

/** A capture or research result, or the plain reason it is not available right now. */
export type Got<T> = { ok: true; value: T } | { ok: false; reason: string };

/** How each source is read; none of them sends input. */
export interface SourceDeps {
  /** A screenshot of a connected app through the main-app bridge. */
  app: (app: string) => Promise<Got<Frame>>;
  /** Side-research findings about a topic (AI, web). */
  web: (topic: string) => Promise<Got<string[]>>;
  /** The PC's live screen. */
  pc: () => Promise<Got<Frame>>;
  /** The demo environment as it is right now. */
  demo: () => Promise<Got<Frame>>;
}

/** One gathered source: the slide it gives, or why it was skipped. */
export type Gathered = { request: SourceRequest; ok: true; spec: SlideSpec } | { request: SourceRequest; ok: false; reason: string };

const DEFAULT_TITLE: Record<SourceKind, (subject: string) => string> = {
  app: (s) => `${s || 'Connected app'} (connected app)`,
  web: (s) => `Research: ${s}`,
  pc: () => 'On the PC',
  demo: () => 'In the demo world',
};

const shotItems = (frame: Frame, note: string): SlideItem[] => [{ kind: 'screenshot', frame }, { kind: 'note', text: note }];

/** Each source kind's reader: the slide items it gives, or why it cannot. */
const READERS: Record<SourceKind, (subject: string, deps: SourceDeps) => Promise<Got<SlideItem[]>>> = {
  app: async (subject, deps) => {
    if (!subject) return { ok: false, reason: 'no app named' };
    const r = await deps.app(subject);
    return r.ok ? { ok: true, value: shotItems(r.value, `Captured from ${subject} via the main-app bridge`) } : r;
  },
  web: async (subject, deps) => {
    if (!subject) return { ok: false, reason: 'no research topic' };
    const r = await deps.web(subject);
    if (!r.ok) return r;
    return r.value.length ? { ok: true, value: r.value.map((text) => ({ kind: 'research', text, source: `side research: ${subject}` })) } : { ok: false, reason: `research on "${subject}" found nothing` };
  },
  pc: async (_subject, deps) => {
    const r = await deps.pc();
    return r.ok ? { ok: true, value: shotItems(r.value, 'Live screenshot of the PC') } : r;
  },
  demo: async (_subject, deps) => {
    const r = await deps.demo();
    return r.ok ? { ok: true, value: shotItems(r.value, 'Snapshot of the virtual demo environment') } : r;
  },
};

/** Reads one source; a throw is a skip with its message, never a failure of the whole presentation. */
export async function gatherSource(request: SourceRequest, deps: SourceDeps): Promise<Gathered> {
  const subject = request.subject?.trim() ?? '';
  try {
    const r = await READERS[request.kind](subject, deps);
    if (!r.ok) return { request, ok: false, reason: `${request.kind} source skipped — ${r.reason}` };
    return { request, ok: true, spec: { title: request.title?.trim() || DEFAULT_TITLE[request.kind](subject), items: r.value } };
  } catch (error) {
    return { request, ok: false, reason: `${request.kind} source skipped — ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Reads every source in order: the slides of those available and the reasons of those skipped. */
export async function gatherSources(requests: SourceRequest[], deps: SourceDeps): Promise<{ specs: SlideSpec[]; skipped: string[] }> {
  const all: Gathered[] = [];
  for (const r of requests) all.push(await gatherSource(r, deps));
  return { specs: all.flatMap((g) => (g.ok ? [g.spec] : [])), skipped: all.flatMap((g) => (g.ok ? [] : [g.reason])) };
}

/** `raw` (parsed JSON) as source requests; entries with an unknown kind are dropped. */
export function parseSourceRequests(raw: unknown): SourceRequest[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const kind = SOURCE_KINDS.find((k) => k === o.kind);
    if (!kind) return [];
    return [{ kind, ...(typeof o.subject === 'string' ? { subject: o.subject } : {}), ...(typeof o.title === 'string' ? { title: o.title } : {}) }];
  });
}
