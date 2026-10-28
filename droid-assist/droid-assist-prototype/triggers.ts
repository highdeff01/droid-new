import type { Frame, SavedCard } from './types.js';
import { MATCHED, boxDistance } from './drift.js';
import type { MappedElement } from './element-map-studio.js';
import type { SavedOperation } from './saved-operations.js';

/** How often the trigger loop checks schedules and the newest live frame. */
export const TRIGGER_TICK_MS = 1000;

/** Most triggers kept. */
export const TRIGGER_LIMIT = 50;

/** What happened to a mapped element between two evaluated frames. */
export const ELEMENT_EVENTS = ['appear', 'disappear', 'change'] as const;
export type ElementEvent = (typeof ELEMENT_EVENTS)[number];

/** What a trigger runs: a saved flow from the Library, the current draft card (the unsaved plan), or a saved operation. */
export type TriggerTarget = { kind: 'card'; cardId: string } | { kind: 'draft' } | { kind: 'operation'; operationId: string };

interface TriggerBase {
  id: string;
  name: string;
  enabled: boolean;
  /** Seconds after a fire during which the trigger does not fire again. */
  cooldownSec: number;
  /** Most fires before the trigger disables itself; 0 = unlimited. */
  maxRuns: number;
  /** Fires so far. */
  runs: number;
  /** When it last fired (ms since epoch). */
  lastFired?: number;
  target: TriggerTarget;
}

/** Runs its target when a mapped element appears, disappears or changes on the live frame. */
export interface ElementTrigger extends TriggerBase {
  kind: 'element';
  elementId: string;
  event: ElementEvent;
}

/** Runs its target at `at`, then every `everySec` seconds (0 = once). */
export interface ScheduleTrigger extends TriggerBase {
  kind: 'schedule';
  /** Next due time (ms since epoch). */
  at: number;
  everySec: number;
}

export type Trigger = ElementTrigger | ScheduleTrigger;
export type TriggerKind = Trigger['kind'];

/** What the Triggers panel submits; the engine adds the id and counters. */
export type TriggerDraft = Omit<ElementTrigger, 'id' | 'runs' | 'lastFired' | 'enabled'> | Omit<ScheduleTrigger, 'id' | 'runs' | 'lastFired' | 'enabled'>;

/** A mapped element's state on one evaluated frame: whether its template matches there, and the pixels. */
export interface ElementSnapshot {
  /** null when the element was mapped without a template frame (presence cannot be judged). */
  present: boolean | null;
  data: ImageData;
}

/** Whether the element's mapped template matches the live frame inside its boundary; null without a template. */
export function elementPresent(el: MappedElement, frame: Frame): boolean | null {
  return el.frame ? boxDistance(el.frame.data, frame.data, el.box) <= MATCHED : null;
}

/** The element's snapshot on `frame` and the events since `prev` (none on the first, baseline frame). */
export function observeElement(el: MappedElement, prev: ElementSnapshot | undefined, frame: Frame): { snapshot: ElementSnapshot; events: ElementEvent[] } {
  const snapshot: ElementSnapshot = { present: elementPresent(el, frame), data: frame.data };
  if (!prev) return { snapshot, events: [] };
  const events: ElementEvent[] = [];
  if (prev.present === false && snapshot.present === true) events.push('appear');
  if (prev.present === true && snapshot.present === false) events.push('disappear');
  if (boxDistance(prev.data, frame.data, el.box) > MATCHED) events.push('change');
  return { snapshot, events };
}

/** Why a due trigger does not fire, or null when it may. */
export type GateSkip = { reason: 'disabled' | 'limit' | 'cooldown'; detail: string };

/** The enable / run-limit / cooldown gate for a trigger that is due at `now`. */
export function fireGate(t: Trigger, now: number): GateSkip | null {
  if (!t.enabled) return { reason: 'disabled', detail: 'disabled' };
  if (t.maxRuns > 0 && t.runs >= t.maxRuns) return { reason: 'limit', detail: `run limit ${t.maxRuns} reached` };
  const left = t.lastFired === undefined ? 0 : t.lastFired + t.cooldownSec * 1000 - now;
  return left > 0 ? { reason: 'cooldown', detail: `cooldown — ${Math.ceil(left / 1000)} s of ${t.cooldownSec} s left` } : null;
}

/** Whether a schedule trigger is due at `now`. */
export const scheduleDue = (t: ScheduleTrigger, now: number) => t.enabled && now >= t.at;

/** The schedule moved past `now`: the next interval step, or disabled when it runs once. */
function advance(t: ScheduleTrigger, now: number): ScheduleTrigger {
  if (t.everySec <= 0) return { ...t, enabled: false };
  const step = t.everySec * 1000;
  return { ...t, at: t.at + Math.max(1, Math.floor((now - t.at) / step) + 1) * step };
}

/** The occurrence at `now` was consumed without firing (cooldown, abort, missing target). */
export const afterSkip = (t: Trigger, now: number): Trigger => (t.kind === 'schedule' && now >= t.at ? advance(t, now) : t);

/** The trigger after firing at `now`: counted, cooldown started, schedule advanced, disabled at its run limit. */
export function afterFire(t: Trigger, now: number): Trigger {
  const fired = { ...afterSkip(t, now), runs: t.runs + 1, lastFired: now };
  return fired.maxRuns > 0 && fired.runs >= fired.maxRuns ? { ...fired, enabled: false } : fired;
}

const wholeAtLeast0 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

/** A new trigger from the panel's draft: counters zeroed, numbers clamped to whole non-negative values. */
export function createTrigger(draft: TriggerDraft, id: string): Trigger {
  const base = { ...draft, id, name: draft.name.trim(), enabled: true, runs: 0, cooldownSec: wholeAtLeast0(draft.cooldownSec), maxRuns: wholeAtLeast0(draft.maxRuns) };
  return base.kind === 'schedule' ? { ...base, everySec: wholeAtLeast0(base.everySec) } : base;
}

/** A trigger target's owner: what to name it as, and the saved flow or operation whose steps run. */
export type ResolvedTarget = { name: string; card?: SavedCard; operation?: SavedOperation };

/** The trigger's target as steps' owner, or the reason it cannot run now. */
export function resolveTarget(target: TriggerTarget, cards: SavedCard[], draft: { name: string } | null, operations: SavedOperation[] = []): ResolvedTarget | { error: string } {
  if (target.kind === 'draft') return draft ? { name: `draft card "${draft.name}"` } : { error: 'no draft card — plan a goal first' };
  if (target.kind === 'operation') {
    const operation = operations.find((o) => o.id === target.operationId);
    return operation ? { name: `operation "${operation.name}"`, operation } : { error: 'its saved operation was deleted' };
  }
  const card = cards.find((c) => c.id === target.cardId);
  return card ? { name: `flow "${card.name}"`, card } : { error: 'its saved flow was deleted' };
}

/** The target in words, for the panel and the log. */
export function targetText(target: TriggerTarget, cards: SavedCard[], operations: SavedOperation[]): string {
  if (target.kind === 'draft') return 'the draft card';
  const r = resolveTarget(target, cards, null, operations);
  if (!('error' in r)) return r.name;
  return target.kind === 'card' ? 'flow "deleted flow"' : 'operation "deleted operation"';
}

const EVENT_TEXT: Record<ElementEvent, string> = { appear: 'appears', disappear: 'disappears', change: 'changes' };

/** What a triggered run did: steps verified/executed of those run, as a dry run or real input, stopped or not. */
export interface RunOutcome {
  ok: number;
  total: number;
  dryRun: boolean;
  stopped: boolean;
}

/** A triggered run's result line and log tone; null = refused before any step ran. */
export function outcomeText(o: RunOutcome | null): { text: string; tone: 'ok' | 'warn' | 'error' } {
  if (!o) return { text: 'refused before any step ran (see the log above)', tone: 'error' };
  const what = o.dryRun ? 'verified as a dry run (no input sent)' : 'executed as real input';
  const text = `${o.ok}/${o.total} step(s) ${what}${o.stopped ? ' — stopped' : ''}`;
  return { text, tone: o.ok === o.total && !o.stopped ? 'ok' : 'warn' };
}

/** The trigger's condition in words, for the panel and the log. */
export function conditionText(t: Trigger, elements: MappedElement[]): string {
  if (t.kind === 'schedule') return `${t.everySec > 0 ? `every ${t.everySec} s from` : 'once at'} ${new Date(t.at).toLocaleString()}`;
  const el = elements.find((e) => e.id === t.elementId);
  return `when "${el?.name ?? 'deleted element'}" ${EVENT_TEXT[t.event]}`;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function isTarget(v: unknown): v is TriggerTarget {
  return isObject(v) && (v.kind === 'draft' || (v.kind === 'card' && isStr(v.cardId)) || (v.kind === 'operation' && isStr(v.operationId)));
}

const KIND_FIELDS: Record<TriggerKind, (v: Json) => boolean> = {
  element: (v) => isStr(v.elementId) && ELEMENT_EVENTS.includes(v.event as ElementEvent),
  schedule: (v) => isNum(v.at) && isNum(v.everySec),
};

/** A stored trigger is well formed (used when loading from storage). */
export function isTrigger(v: unknown): v is Trigger {
  return isObject(v) && isStr(v.id) && typeof v.name === 'string' && typeof v.enabled === 'boolean' && isNum(v.cooldownSec) && isNum(v.maxRuns) && isNum(v.runs)
    && (v.lastFired === undefined || isNum(v.lastFired)) && isTarget(v.target) && (v.kind === 'element' || v.kind === 'schedule') && KIND_FIELDS[v.kind](v);
}
