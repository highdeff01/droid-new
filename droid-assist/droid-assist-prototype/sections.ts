import type { FamiliarElement, Frame } from './types.js';
import type { Box } from './assist-ai.js';
import type { AiReply, AskRequest } from './ai.js';
import { parseJsonReply } from './ai.js';
import { boxCenter, type MappedElement } from './element-map-studio.js';
import { uid } from './planner.js';

/** Most sections kept, and most log/change events each section keeps. */
export const SECTION_LIMIT = 24;
export const SECTION_EVENT_LIMIT = 50;

/** One event in a section's history: a log line or a detected screen change. */
export interface SectionEvent {
  time: number;
  kind: 'log' | 'change';
  text: string;
  /** Where on the screen it happened (normalized), when known. */
  box?: Box;
}

/** A named region of the captured screen (sidebar, toolbar, main content...), drawn by the user or proposed by the AI. */
export interface ScreenSection {
  id: string;
  name: string;
  box: Box;
  source: 'drawn' | 'ai';
  /** Per-section log and change history, newest first. */
  events: SectionEvent[];
}

type Point = { x: number; y: number };

/** One element inside a section with its position dossier: where it sits relative to the section. */
export interface SectionElement {
  name: string;
  /** Centre, normalized to the whole screen. */
  x: number;
  y: number;
  /** One-line position dossier scoped to the section. */
  dossier: string;
}

/** Everything a section knows: its elements with dossiers, its log and its change history. */
export interface SectionProfile {
  section: ScreenSection;
  elements: SectionElement[];
  log: SectionEvent[];
  changes: SectionEvent[];
}

const key = (name: string) => name.trim().toLowerCase();
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** True when `p` lies inside `box` (edges inclusive). */
export const pointIn = (p: Point, box: Box) => p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;

/** True when two boxes overlap at all (touching edges count). */
export const intersects = (a: Box, b: Box) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

/** True when an element (a point or a box, by its centre) belongs to the section. */
export const inSection = (section: ScreenSection, el: Point | Box) => pointIn('w' in el ? boxCenter(el) : el, section.box);

/** A new section with an empty history; null for a blank name. */
export function createSection(name: string, box: Box, source: ScreenSection['source']): ScreenSection | null {
  const trimmed = name.trim();
  return trimmed ? { id: uid('sec'), name: trimmed, box, source, events: [] } : null;
}

/** Adds a section, replacing one with the same name (case-insensitive, keeping its history); newest first, capped. */
export function addSection(list: ScreenSection[], section: ScreenSection): ScreenSection[] {
  const prior = list.find((s) => key(s.name) === key(section.name));
  const merged = prior ? { ...section, events: [...section.events, ...prior.events].slice(0, SECTION_EVENT_LIMIT) } : section;
  return [merged, ...list.filter((s) => s !== prior)].slice(0, SECTION_LIMIT);
}

/** Drops the section with `id`. */
export const removeSection = (list: ScreenSection[], id: string) => list.filter((s) => s.id !== id);

/** The section named `name` (case-insensitive), or undefined. */
export const findSection = (list: ScreenSection[], name: string) => list.find((s) => key(s.name) === key(name));

/**
 * Appends an event to every section it concerns: those its box intersects, or every section when it has
 * no box (a run-wide log line). Newest first, capped per section.
 */
export function recordEvent(list: ScreenSection[], event: SectionEvent): ScreenSection[] {
  return list.map((s) => (!event.box || intersects(s.box, event.box) ? { ...s, events: [event, ...s.events].slice(0, SECTION_EVENT_LIMIT) } : s));
}

/** A position dossier line: the element's place inside the section, as a share of the section and in screen pixels. */
export function dossierLine(section: ScreenSection, name: string, p: Point, frame?: Pick<Frame, 'srcW' | 'srcH'>): string {
  const rx = section.box.w ? (p.x - section.box.x) / section.box.w : 0;
  const ry = section.box.h ? (p.y - section.box.y) / section.box.h : 0;
  const px = frame ? `, (${Math.round(p.x * frame.srcW)}, ${Math.round(p.y * frame.srcH)})px` : '';
  return `"${name}" in "${section.name}" at ${pct(rx)} across, ${pct(ry)} down the section (screen ${pct(p.x)}, ${pct(p.y)}${px})`;
}

/** Every mapped and familiar element inside the section, each with its dossier; a name seen in both is listed once (mapped wins). */
export function sectionElements(section: ScreenSection, mapped: MappedElement[], familiar: FamiliarElement[], frame?: Pick<Frame, 'srcW' | 'srcH'>): SectionElement[] {
  const points = [...mapped.map((m) => ({ name: m.name, ...boxCenter(m.box) })), ...familiar.map((f) => ({ name: f.name, x: f.x, y: f.y }))];
  const seen = new Set<string>();
  return points.filter((p) => inSection(section, p) && !seen.has(key(p.name)) && seen.add(key(p.name)))
    .map((p) => ({ name: p.name, x: p.x, y: p.y, dossier: dossierLine(section, p.name, p, frame) }));
}

/** The profile of every section: its elements with dossiers, its log and its change history. */
export function buildProfiles(sections: ScreenSection[], mapped: MappedElement[], familiar: FamiliarElement[], frame?: Pick<Frame, 'srcW' | 'srcH'>): SectionProfile[] {
  return sections.map((section) => ({
    section,
    elements: sectionElements(section, mapped, familiar, frame),
    log: section.events.filter((e) => e.kind === 'log'),
    changes: section.events.filter((e) => e.kind === 'change'),
  }));
}

/** The sections a goal is scoped to; names that match no section are ignored. */
export const scopeSections = (sections: ScreenSection[], scope: string[]) => sections.filter((s) => scope.some((n) => key(n) === key(s.name)));

/**
 * Goal seclusion for a point: true when the scope is empty or resolves to no section (whole screen), or
 * when the point lies inside a scoped section.
 */
export function inScope(sections: ScreenSection[], scope: string[], p: Point): boolean {
  const scoped = scopeSections(sections, scope);
  return !scoped.length || scoped.some((s) => pointIn(p, s.box));
}

/** Goal seclusion for a screen change: true when the scope is open or the change box intersects a scoped section. */
export function changeInScope(sections: ScreenSection[], scope: string[], box: Box): boolean {
  const scoped = scopeSections(sections, scope);
  return !scoped.length || scoped.some((s) => intersects(s.box, box));
}

/** The mapped elements grounding may use under the scope (all of them when the scope is open). */
export const scopedMapped = (sections: ScreenSection[], scope: string[], mapped: MappedElement[]) => mapped.filter((m) => inScope(sections, scope, boxCenter(m.box)));

/** One planning-context line telling the model which sections the goal is secluded to; empty when the scope is open. */
export function scopeLines(sections: ScreenSection[], scope: string[]): string[] {
  const scoped = scopeSections(sections, scope);
  if (!scoped.length) return [];
  const boxes = scoped.map((s) => `"${s.name}" x=${pct(s.box.x)}..${pct(s.box.x + s.box.w)}, y=${pct(s.box.y)}..${pct(s.box.y + s.box.h)}`).join('; ');
  return [`[Goal scope] Act ONLY inside these screen sections and ignore everything outside them: ${boxes}`];
}

/** System prompt of the section-proposal request. */
export const SECTIONS_SYSTEM = `You are Droid Assist's screen sectioner. Split the user's main app screen into its distinct named regions (e.g. sidebar, toolbar, main content, preview area) using the screenshot and the element inventory.
Reply ONLY with JSON {"sections":[{"name":string,"x":number,"y":number,"w":number,"h":number}]} where x,y,w,h are fractions 0..1 of the screen.`;

/** The AI section-proposal request: the live frame plus the known elements as the inventory. */
export function sectionsRequest(frame: Frame, mapped: MappedElement[], familiar: FamiliarElement[]): AskRequest {
  const inventory = [...mapped.map((m) => `"${m.name}" at ${pct(boxCenter(m.box).x)}, ${pct(boxCenter(m.box).y)}`), ...familiar.map((f) => `"${f.name}" at ${pct(f.x)}, ${pct(f.y)}`)];
  return { system: SECTIONS_SYSTEM, prompt: `Element inventory:\n${inventory.join('\n') || '(none known yet)'}`, frame, json: true };
}

const unit = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);

/** The AI-proposed sections of a reply; entries without a name or a valid in-screen box are dropped. Throws AiParseError on a reply without JSON. */
export function parseSectionProposals(reply: AiReply): ScreenSection[] {
  const raw = parseJsonReply(reply.content).sections;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    if (!r || typeof r !== 'object') return [];
    const o = r as Record<string, unknown>;
    const [x, y, w, h] = [unit(o.x), unit(o.y), unit(o.w), unit(o.h)];
    if (x === null || y === null || !w || !h || typeof o.name !== 'string') return [];
    const section = createSection(o.name, { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) }, 'ai');
    return section ? [section] : [];
  });
}

/**
 * Cross-referenced section memory for the memory view and planning: one summary line per section, plus a
 * line for every log/change text seen in two or more sections, so a pattern learned in one informs the others.
 */
export function sectionMemoryLines(profiles: SectionProfile[]): string[] {
  const summaries = profiles.map(({ section, elements, log, changes }) =>
    `[Section] "${section.name}" (${section.source}): ${elements.length} element(s)${elements.length ? ` — ${elements.map((e) => e.name).join(', ')}` : ''}; ${log.length} log, ${changes.length} change(s)${section.events[0] ? `; latest: ${section.events[0].text}` : ''}`);
  const where = new Map<string, { text: string; names: string[] }>();
  for (const { section } of profiles) {
    for (const e of section.events) {
      const entry = where.get(key(e.text)) ?? { text: e.text, names: [] };
      if (!entry.names.includes(section.name)) entry.names.push(section.name);
      where.set(key(e.text), entry);
    }
  }
  const shared = [...where.values()].filter((e) => e.names.length > 1).map((e) => `[Section pattern] "${e.text}" seen in ${e.names.map((n) => `"${n}"`).join(', ')} — apply it across these sections`);
  return [...summaries, ...shared];
}
