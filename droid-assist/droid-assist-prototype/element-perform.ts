import type { Frame, WorkflowStep } from './types.js';
import type { AiReply, AskRequest } from './ai.js';
import { AiError, parseJsonReply, toUnit } from './ai.js';
import { uid } from './planner.js';
import { boxCenter, mappedLine, type MappedElement, type PerformFn, type PerformKind } from './element-map-studio.js';

/**
 * Perform functions: what an element does when a workflow auto-navigates to it. A perform is set
 * by the user or proposed by the AI; a navigate step names the element by id and is re-aimed at
 * the element's current position whenever it runs, so a moved element is still hit.
 */

export const PERFORM_KINDS: readonly PerformKind[] = ['click', 'double_click', 'type', 'drag'];

/** Why a perform function or a navigate step cannot be used. */
export type PerformCheck = { ok: true } | { ok: false; error: string };

const onScreen = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** Whether `p` is complete: `type` needs text, `drag` needs a drop point or a drop element. */
export function checkPerform(p: PerformFn): PerformCheck {
  if (!PERFORM_KINDS.includes(p.kind)) return { ok: false, error: `unknown perform "${String(p.kind)}"` };
  if (p.kind === 'type' && !p.text?.trim()) return { ok: false, error: 'a type perform needs text' };
  if (p.kind === 'drag' && !p.toElementId && !(p.to && onScreen(p.to.x) && onScreen(p.to.y))) return { ok: false, error: 'a drag perform needs a drop point or drop element' };
  return { ok: true };
}

/** Sets (or with null clears) the perform function of element `id`; an incomplete perform changes nothing. */
export function setPerform(list: MappedElement[], id: string, p: PerformFn | null): MappedElement[] {
  if (p && !checkPerform(p).ok) return list;
  return list.map((e) => {
    if (e.id !== id) return e;
    if (p) return { ...e, perform: p };
    const { perform: _perform, ...rest } = e;
    return rest;
  });
}

/** A short description of a perform, e.g. `type "hello"` or `drag to "Bin"`. */
export function performText(p: PerformFn, map: MappedElement[] = []): string {
  if (p.kind === 'type') return `type "${p.text ?? ''}"`;
  if (p.kind !== 'drag') return p.kind.replace('_', ' ');
  const target = p.toElementId ? map.find((e) => e.id === p.toElementId) : undefined;
  if (target) return `drag to "${target.name}"`;
  return p.to ? `drag to (${(p.to.x * 100).toFixed(1)}%, ${(p.to.y * 100).toFixed(1)}%)` : 'drag';
}

/** Where a drag perform drops: the drop element's current centre, else its point; null when neither exists. */
function dropPoint(p: PerformFn, map: MappedElement[]): { x: number; y: number } | null {
  if (p.toElementId) {
    const target = map.find((e) => e.id === p.toElementId);
    return target ? boxCenter(target.box) : null;
  }
  return p.to ?? null;
}

/** The step a perform runs, aimed at the element's current centre (and a drag at its current drop point). */
function stepFor(el: MappedElement, p: PerformFn, map: MappedElement[], id: string): WorkflowStep | { error: string } {
  const c = boxCenter(el.box);
  const base = { id, name: `Auto-navigate to "${el.name}" then ${performText(p, map)}`, action: p.kind, x: c.x, y: c.y, target: el.name, mappedId: el.id, status: 'pending' as const };
  if (p.kind === 'type') return { ...base, text: p.text };
  if (p.kind !== 'drag') return base;
  const to = dropPoint(p, map);
  if (!to) return { error: `the drop element of "${el.name}" is no longer mapped` };
  const dropName = p.toElementId ? map.find((e) => e.id === p.toElementId)?.name : undefined;
  return { ...base, endX: to.x, endY: to.y, ...(dropName ? { endTarget: dropName } : {}) };
}

/** A workflow step "auto-navigate to element `el` then perform its function"; an error when it has none. */
export function navigateStep(el: MappedElement, map: MappedElement[], id = uid('nav')): WorkflowStep | { error: string } {
  if (!el.perform) return { error: `"${el.name}" has no perform function — set one (or ask the AI) first` };
  const check = checkPerform(el.perform);
  if (!check.ok) return { error: `"${el.name}": ${check.error}` };
  return stepFor(el, el.perform, map, id);
}

/**
 * A step as it must run now: a navigate step (one with `mappedId`) is re-aimed at its element's
 * current position with the element's current perform; any other step is returned as is. An
 * element that is gone, or has lost its perform, is an error — never a guess.
 */
export function resolveMappedStep(step: WorkflowStep, map: MappedElement[]): WorkflowStep | { error: string } {
  if (!step.mappedId) return step;
  const el = map.find((e) => e.id === step.mappedId);
  if (!el) return { error: `"${step.target ?? step.name}" is no longer in the element map` };
  const next = navigateStep(el, map, step.id);
  return 'error' in next ? next : { ...next, name: step.name, ...(step.delayMs !== undefined ? { delayMs: step.delayMs } : {}), ...(step.refFrame ? { refFrame: step.refFrame } : {}) };
}

/** The AI's perform proposal for an element, and whether it suggests training the element. */
export interface PerformProposal {
  perform: PerformFn;
  /** The AI suggests running a training session on the element. */
  train: boolean;
  thinking: string | null;
}

/** The perform-proposal system prompt: the reply contract. */
export const PERFORM_SYSTEM = 'You are Droid Assist\'s element coach. The first image is the user\'s screen; the second is a zoomed crop of one mapped element. Propose what a workflow should do with this element when it navigates to it. Reply ONLY with JSON {"kind":"click"|"double_click"|"type"|"drag","text":string,"toX":number,"toY":number,"reason":string,"train":boolean}: text only for type, toX/toY (0..1 of the screen) only for drag, train=true when the element opens links, menus or popups worth exploring.';

/** The perform-proposal request for `el` on `frame` with its crop. */
export function performRequest(el: MappedElement, frame: Frame, crop: Frame): AskRequest {
  return { system: PERFORM_SYSTEM, prompt: mappedLine(el), frame, crops: [crop], context: [], json: true };
}

/** Parses the AI's perform proposal; throws AiError on a malformed reply or an incomplete perform. */
export function parsePerformProposal(reply: AiReply): PerformProposal {
  const r = parseJsonReply(reply.content);
  const kind = String(r.kind) as PerformKind;
  const perform: PerformFn = {
    kind,
    source: 'ai',
    ...(typeof r.reason === 'string' && r.reason.trim() ? { reason: r.reason.trim() } : {}),
    ...(kind === 'type' && typeof r.text === 'string' ? { text: r.text } : {}),
    ...(kind === 'drag' ? { to: { x: toUnit(r.toX, reply.view?.w ?? 480), y: toUnit(r.toY, reply.view?.h ?? 270) } } : {}),
  };
  const check = checkPerform(perform);
  if (!check.ok) throw new AiError(`AI proposed an unusable perform: ${check.error}`);
  return { perform, train: r.train === true, thinking: reply.thinking };
}
