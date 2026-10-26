import type { Annotation, FamiliarElement, WorkflowStep } from './types.js';

/** Most familiar elements kept. */
export const FAMILIAR_LIMIT = 60;

/** Where an element listed in the Elements panel was found. */
export type ElementSource = 'template' | 'popup' | 'familiar';

/** One on-screen element the Elements panel lists, at normalized 0..1 coordinates. */
export interface ScreenElement {
  id: string;
  name: string;
  x: number;
  y: number;
  source: ElementSource;
  /** Small screenshot patch of the element, when known. */
  patch?: string;
  lastSeen?: number;
}

const key = (name: string) => name.trim().toLowerCase();

/**
 * Remembers an element: an entry with the same name (case-insensitive) is updated in place
 * with the new coordinates, patch and last-seen time and moved to the front; otherwise the
 * element is added first. Keeps at most FAMILIAR_LIMIT entries. A blank name changes nothing.
 */
export function rememberElement(list: FamiliarElement[], el: FamiliarElement): FamiliarElement[] {
  if (!el.name.trim()) return list;
  const prev = list.find((e) => key(e.name) === key(el.name));
  const merged: FamiliarElement = { ...el, id: prev?.id ?? el.id, patch: el.patch ?? prev?.patch };
  return [merged, ...list.filter((e) => e !== prev)].slice(0, FAMILIAR_LIMIT);
}

/** Drops the element with `id`. */
export const forgetElement = (list: FamiliarElement[], id: string) => list.filter((e) => e.id !== id);

/**
 * Every element to list: workflow steps whose target was located by template matching (at
 * their drift-corrected point), popups the watcher detected (at the box centre), and the
 * familiar elements from memory.
 */
export function listElements(steps: WorkflowStep[], annotations: Annotation[], familiar: FamiliarElement[]): ScreenElement[] {
  const matched = steps.filter((s) => s.refFrame).map((s): ScreenElement => ({ id: `tpl-${s.id}`, name: s.target ?? s.name, x: s.correctedX ?? s.x, y: s.correctedY ?? s.y, source: 'template' }));
  const popups = annotations.filter((a) => a.tone === 'error').map((a): ScreenElement => ({ id: `pop-${a.id}`, name: a.label, x: a.actX ?? a.x + a.w / 2, y: a.actY ?? a.y + a.h / 2, source: 'popup' }));
  const known = familiar.map((f): ScreenElement => ({ ...f, source: 'familiar' }));
  return [...matched, ...popups, ...known];
}
